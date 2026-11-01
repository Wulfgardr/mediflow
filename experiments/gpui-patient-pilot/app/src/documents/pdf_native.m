// The existing native bridge is linked into the app. Only the early, isolated
// worker entry calls PDFKit. No PDF, stream or raster is written to a file.
#import <PDFKit/PDFKit.h>
#import <ImageIO/ImageIO.h>
#import <CoreText/CoreText.h>
#import <sandbox.h>
#import <libproc.h>
#import <sys/resource.h>
#import <sys/socket.h>
#import <netinet/in.h>
#import <fcntl.h>
#import <unistd.h>
#import <errno.h>
#import <math.h>
#include "adobe_glyph_names.h"

static const size_t inputLimit = 10 * 1024 * 1024;
static const size_t streamLimit = 48 * 1024 * 1024;
static const uint64_t imagePixels = 12000000;
static const char *failure;
static size_t nodes, decodedBytes, operators;
static uint64_t pageImagePixels;
static NSMutableSet<NSValue *> *visited;
static NSMutableSet<NSValue *> *active;

uint64_t MFDocumentPreviewMemory(int pid) {
    struct rusage_info_v4 info = {0};
    if (proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&info) != 0) {
        // Exited children have no live budget. Other failures fail closed.
        return errno == ESRCH ? 0 : UINT64_MAX;
    }
    return MAX(info.ri_phys_footprint, info.ri_resident_size);
}

static bool isolate(void) {
    // PDFKit reads system fonts/framework resources. Network and file writes
    // remain denied, including writes to existing files. Inherited pipes carry
    // the only input/output. Do not add a temporary directory exception.
    const char *profile = "(version 1)(deny default)(allow file-read*)(allow sysctl-read)(allow mach-lookup)(allow process-info* (target self))";
    char *error = NULL;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    int result = sandbox_init(profile, 0, &error);
    if (error) sandbox_free_error(error);
#pragma clang diagnostic pop
    if (result != 0) return false;
    // Check actual syscalls, not sandbox_check's undocumented -1 response.
    errno = 0;
    int fd = open("/dev/null", O_WRONLY);
    bool writesDenied = fd < 0 && (errno == EPERM || errno == EACCES);
    if (fd >= 0) close(fd);
    errno = 0;
    fd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in address = {.sin_len = sizeof(address), .sin_family = AF_INET, .sin_port = htons(9), .sin_addr.s_addr = htonl(INADDR_LOOPBACK)};
    int connected = fd < 0 ? -1 : connect(fd, (struct sockaddr *)&address, sizeof(address));
    bool networkDenied = connected < 0 && (errno == EPERM || errno == EACCES);
    if (fd >= 0) close(fd);
    struct rlimit core = {0, 0};
    return writesDenied && networkDenied && setrlimit(RLIMIT_CORE, &core) == 0;
}

static bool dimensions(int64_t w, int64_t h) {
    if (w <= 0 || h <= 0) { failure = "invalid"; return false; }
    if (w > 8192 || h > 8192 || (uint64_t)w * (uint64_t)h > imagePixels) {
        failure = "image_limit"; return false;
    }
    return true;
}
static bool named(CGPDFDictionaryRef d, const char *key, const char *value) {
    const char *name = NULL;
    return CGPDFDictionaryGetName(d, key, &name) && strcmp(name, value) == 0;
}
static bool present(CGPDFDictionaryRef d, const char *key) {
    CGPDFObjectRef object;
    return CGPDFDictionaryGetObject(d, key, &object);
}
static bool base14(CGPDFDictionaryRef font) {
    const char *name = NULL;
    if (!CGPDFDictionaryGetName(font, "BaseFont", &name)) return false;
    const char *names[] = {"Helvetica","Helvetica-Bold","Helvetica-Oblique","Helvetica-BoldOblique","Times-Roman","Times-Bold","Times-Italic","Times-BoldItalic","Courier","Courier-Bold","Courier-Oblique","Courier-BoldOblique","Symbol","ZapfDingbats",NULL};
    for (const char **n = names; *n; n++) if (!strcmp(name, *n)) return true;
    return false;
}
static bool adobeGlyph(const char *name) {
    size_t low = 0, high = sizeof(adobeGlyphNames) / sizeof(*adobeGlyphNames);
    while (low < high) {
        size_t middle = low + (high - low) / 2;
        int order = strcmp(name, adobeGlyphNames[middle]);
        if (!order) return true;
        if (order < 0) high = middle; else low = middle + 1;
    }
    return false;
}
static CFDataRef copyStream(CGPDFStreamRef stream, CGPDFDataFormat *format) {
    CFDataRef data = CGPDFStreamCopyData(stream, format);
    if (!data) { failure = "invalid"; return NULL; }
    size_t length = CFDataGetLength(data);
    if (length > streamLimit || decodedBytes > streamLimit - length) {
        CFRelease(data); failure = "limit"; return NULL;
    }
    decodedBytes += length;
    return data;
}
static void checkImage(CGPDFStreamRef stream) {
    CGPDFDictionaryRef d = CGPDFStreamGetDictionary(stream);
    CGPDFInteger w = 0, h = 0;
    if (!CGPDFDictionaryGetInteger(d, "Width", &w)) CGPDFDictionaryGetInteger(d, "W", &w);
    if (!CGPDFDictionaryGetInteger(d, "Height", &h)) CGPDFDictionaryGetInteger(d, "H", &h);
    if (!dimensions(w, h)) return;
    pageImagePixels += (uint64_t)w * (uint64_t)h;
    if (pageImagePixels > 24000000) { failure = "image_limit"; return; }
    const char *filter = NULL;
    if (!CGPDFDictionaryGetName(d, "Filter", &filter)) CGPDFDictionaryGetName(d, "F", &filter);
    if (present(d, "Mask") || present(d, "SMask") || (filter && strcmp(filter, "FlateDecode") && strcmp(filter, "Fl") && strcmp(filter, "DCTDecode") && strcmp(filter, "DCT"))) {
        failure = present(d, "Mask") || present(d, "SMask") ? "image_mask" : "image_format"; return;
    }
    CGPDFDataFormat format;
    CFDataRef bytes = copyStream(stream, &format);
    if (!bytes) return;
    if (format == CGPDFDataFormatJPEGEncoded) {
        // ImageIO properties inspect the actual encoded frame before creating a
        // raster. A lying PDF Width/Height must not bypass the Web pixel limit.
        CGImageSourceRef source = CGImageSourceCreateWithData(bytes, (__bridge CFDictionaryRef)@{(id)kCGImageSourceShouldCache:@NO});
        NSDictionary *properties = source ? CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, NULL)) : nil;
        if (!properties) failure = "invalid";
        else {
            int64_t realWidth = [properties[(id)kCGImagePropertyPixelWidth] longLongValue];
            int64_t realHeight = [properties[(id)kCGImagePropertyPixelHeight] longLongValue];
            if (dimensions(realWidth, realHeight) && (realWidth != w || realHeight != h)) failure = "invalid";
        }
        if (source) CFRelease(source);
    } else if (format != CGPDFDataFormatRaw) failure = "image_format";
    CFRelease(bytes);
}
static void walk(CGPDFObjectRef object, size_t depth);
struct WalkContext { size_t depth; };
static void entry(const char *key, CGPDFObjectRef value, void *info) {
    if (!strcmp(key, "Parent")) return; // structural backlink, not content
    walk(value, ((struct WalkContext *)info)->depth + 1);
}
static void checkDictionary(CGPDFDictionaryRef d, size_t depth) {
    if (present(d, "Annots")) { failure = "annotations"; return; }
    if (present(d, "SMask") || present(d, "Mask")) { failure = "image_mask"; return; }
    if (named(d,"Subtype","Form")) { failure = "nested_graphics"; return; }
    if (named(d,"Subtype","Type3")) { failure = "font"; return; }
    if (present(d, "XFA") || present(d, "Pattern")) { failure = "unsupported"; return; }
    CGPDFObjectRef contents;
    if (CGPDFDictionaryGetObject(d, "Contents", &contents)) {
        CGPDFArrayRef array;
        if (CGPDFObjectGetType(contents) == kCGPDFObjectTypeArray && CGPDFObjectGetValue(contents, kCGPDFObjectTypeArray, &array)) {
            for (size_t i = 0; i < CGPDFArrayGetCount(array); i++) {
                CGPDFStreamRef stream;
                if (!CGPDFArrayGetStream(array, i, &stream)) { failure = "invalid"; return; }
            }
        } else if (CGPDFObjectGetType(contents) != kCGPDFObjectTypeStream) { failure = "invalid"; return; }
    }
    if (named(d,"Type","Font") && !present(d,"FontDescriptor") && !named(d,"Subtype","Type0")) {
        if (!base14(d)) { failure = "font"; return; }
    }
    for (const char **key = (const char *[]){"FontFile", "FontFile2", "FontFile3", NULL}; *key; key++) {
        CGPDFStreamRef font;
        if (CGPDFDictionaryGetStream(d, *key, &font)) {
            CGPDFDataFormat format;
            CFDataRef data = copyStream(font, &format);
            if (!data) return;
            CFArrayRef descriptors = CTFontManagerCreateFontDescriptorsFromData(data);
            if (!descriptors || CFArrayGetCount(descriptors) == 0) failure = "font";
            if (descriptors) CFRelease(descriptors);
            CFRelease(data);
        }
    }
    struct WalkContext context = {depth};
    CGPDFDictionaryApplyFunction(d, entry, &context);
}
static void walk(CGPDFObjectRef object, size_t depth) {
    if (failure) return;
    if (++nodes > 500000 || depth > 32) { failure = "limit"; return; }
    NSValue *key = [NSValue valueWithPointer:object];
    if ([active containsObject:key]) { failure = "invalid"; return; }
    if ([visited containsObject:key]) return;
    [active addObject:key];
    CGPDFObjectType type = CGPDFObjectGetType(object);
    if (type == kCGPDFObjectTypeDictionary) {
        CGPDFDictionaryRef dict; CGPDFObjectGetValue(object, type, &dict);
        checkDictionary(dict, depth);
    } else if (type == kCGPDFObjectTypeArray) {
        CGPDFArrayRef array; CGPDFObjectGetValue(object, type, &array);
        for (size_t n = 0; n < CGPDFArrayGetCount(array) && !failure; n++) {
            CGPDFObjectRef value;
            if (!CGPDFArrayGetObject(array, n, &value)) { failure = "invalid"; break; }
            walk(value, depth + 1);
        }
    } else if (type == kCGPDFObjectTypeStream) {
        CGPDFStreamRef stream; CGPDFObjectGetValue(object, type, &stream);
        CGPDFDictionaryRef dict = CGPDFStreamGetDictionary(stream);
        if (named(dict,"Subtype","Image")) checkImage(stream);
        checkDictionary(dict, depth);
    }
    [active removeObject:key];
    [visited addObject:key];
}
static void countOperator(CGPDFScannerRef scanner, void *info) {
    (void)scanner; (void)info;
    if (++operators > 50000) failure = "limit";
}
struct FontUse {
    const char *names[256];
    uint8_t checked[256];
    CGFontRef embedded;
    bool standard;
};
struct TextUse {
    CGPDFDictionaryRef font;
    __unsafe_unretained NSMutableArray<NSValue *> *stack;
    __unsafe_unretained NSMutableDictionary<NSValue *, NSValue *> *fonts;
};
static struct FontUse *fontUse(CGPDFDictionaryRef font, struct TextUse *text) {
    NSValue *key = [NSValue valueWithPointer:font];
    struct FontUse *use = [text->fonts[key] pointerValue];
    if (use) return use;
    use = calloc(1, sizeof(*use));
    if (!use) { failure = "engine"; return NULL; }
    text->fonts[key] = [NSValue valueWithPointer:use];
    use->standard = base14(font);
    CGPDFDictionaryRef encoding;
    CGPDFArrayRef differences;
    if (!CGPDFDictionaryGetDictionary(font, "Encoding", &encoding) || !present(encoding, "Differences")) return use;
    if (!CGPDFDictionaryGetArray(encoding, "Differences", &differences)) { failure = "invalid"; return use; }
    CGPDFInteger code = -1;
    for (size_t i = 0; i < CGPDFArrayGetCount(differences); i++) {
        CGPDFObjectRef item;
        if (!CGPDFArrayGetObject(differences, i, &item)) { failure = "invalid"; break; }
        if (CGPDFObjectGetType(item) == kCGPDFObjectTypeInteger) {
            CGPDFObjectGetValue(item, kCGPDFObjectTypeInteger, &code);
            if (code < 0 || code > 255) { failure = "invalid"; break; }
        } else if (CGPDFObjectGetType(item) == kCGPDFObjectTypeName && code >= 0 && code <= 255) {
            CGPDFObjectGetValue(item, kCGPDFObjectTypeName, &use->names[code++]);
        } else { failure = "invalid"; break; }
    }
    return use;
}
static void loadEmbeddedFont(CGPDFDictionaryRef font, struct FontUse *use) {
    CGPDFDictionaryRef descriptor;
    if (!CGPDFDictionaryGetDictionary(font, "FontDescriptor", &descriptor)) return;
    for (const char **key = (const char *[]){"FontFile", "FontFile2", "FontFile3", NULL}; *key; key++) {
        CGPDFStreamRef stream;
        if (!CGPDFDictionaryGetStream(descriptor, *key, &stream)) continue;
        CGPDFDataFormat format;
        CFDataRef data = copyStream(stream, &format);
        if (!data) return;
        CGDataProviderRef provider = CGDataProviderCreateWithCFData(data);
        if (provider) { use->embedded = CGFontCreateWithDataProvider(provider); CGDataProviderRelease(provider); }
        CFRelease(data);
        return;
    }
}
static void checkText(CGPDFStringRef string, struct TextUse *text) {
    if (failure) return;
    if (!text->font) { failure = "invalid"; return; }
    struct FontUse *use = fontUse(text->font, text);
    if (!use || failure) return;
    const unsigned char *bytes = CGPDFStringGetBytePtr(string);
    for (size_t i = 0; i < CGPDFStringGetLength(string) && !failure; i++) {
        unsigned int code = bytes[i];
        const char *name = use->names[code];
        if (!name || use->checked[code]) continue;
        bool resolved = false;
        CGPDFDictionaryRef descriptor;
        bool embedded = CGPDFDictionaryGetDictionary(text->font, "FontDescriptor", &descriptor)
            && (present(descriptor, "FontFile") || present(descriptor, "FontFile2") || present(descriptor, "FontFile3"));
        if (embedded) {
            if (!use->embedded) loadEmbeddedFont(text->font, use);
            NSString *glyphName = [NSString stringWithUTF8String:name];
            resolved = use->embedded && glyphName && CGFontGetGlyphWithGlyphName(use->embedded, (__bridge CFStringRef)glyphName) != 0;
        } else if (use->standard) resolved = adobeGlyph(name);
        if (!resolved && !failure) failure = "font_encoding";
        use->checked[code] = 1;
    }
}
static void selectFont(CGPDFScannerRef scanner, void *info) {
    countOperator(scanner, info);
    CGPDFReal size;
    const char *name;
    if (!CGPDFScannerPopNumber(scanner, &size) || !isfinite(size) || !CGPDFScannerPopName(scanner, &name)) { failure = "invalid"; return; }
    CGPDFObjectRef font = CGPDFContentStreamGetResource(CGPDFScannerGetContentStream(scanner), "Font", name);
    struct TextUse *text = info;
    if (!font || !CGPDFObjectGetValue(font, kCGPDFObjectTypeDictionary, &text->font)) failure = "invalid";
}
static void showText(CGPDFScannerRef scanner, void *info) {
    countOperator(scanner, info);
    CGPDFStringRef string;
    if (!CGPDFScannerPopString(scanner, &string)) failure = "invalid";
    else checkText(string, info);
}
static void spacedText(CGPDFScannerRef scanner, void *info) {
    showText(scanner, info);
    CGPDFReal character, word;
    if (!CGPDFScannerPopNumber(scanner, &character) || !CGPDFScannerPopNumber(scanner, &word) || !isfinite(character) || !isfinite(word)) failure = "invalid";
}
static void showTextArray(CGPDFScannerRef scanner, void *info) {
    countOperator(scanner, info);
    CGPDFArrayRef array;
    if (!CGPDFScannerPopArray(scanner, &array)) { failure = "invalid"; return; }
    for (size_t i = 0; i < CGPDFArrayGetCount(array) && !failure; i++) {
        CGPDFObjectRef item;
        CGPDFStringRef string;
        if (!CGPDFArrayGetObject(array, i, &item)) { failure = "invalid"; break; }
        if (CGPDFObjectGetValue(item, kCGPDFObjectTypeString, &string)) checkText(string, info);
        else if (CGPDFObjectGetType(item) != kCGPDFObjectTypeInteger && CGPDFObjectGetType(item) != kCGPDFObjectTypeReal) failure = "invalid";
    }
}
static void saveTextState(CGPDFScannerRef scanner, void *info) {
    countOperator(scanner, info);
    struct TextUse *text = info;
    [text->stack addObject:[NSValue valueWithPointer:text->font]];
}
static void restoreTextState(CGPDFScannerRef scanner, void *info) {
    countOperator(scanner, info);
    struct TextUse *text = info;
    if (!text->stack.count) { failure = "invalid"; return; }
    text->font = [text->stack.lastObject pointerValue];
    [text->stack removeLastObject];
}
static void graphicsTextState(CGPDFScannerRef scanner, void *info) {
    countOperator(scanner, info);
    const char *name;
    if (!CGPDFScannerPopName(scanner, &name)) { failure = "invalid"; return; }
    CGPDFObjectRef object = CGPDFContentStreamGetResource(CGPDFScannerGetContentStream(scanner), "ExtGState", name);
    CGPDFDictionaryRef state;
    CGPDFArrayRef font;
    CGPDFReal size;
    struct TextUse *text = info;
    if (!object || !CGPDFObjectGetValue(object, kCGPDFObjectTypeDictionary, &state)) { failure = "invalid"; return; }
    if (present(state, "Font") && (!CGPDFDictionaryGetArray(state, "Font", &font) || CGPDFArrayGetCount(font) != 2 || !CGPDFArrayGetDictionary(font, 0, &text->font) || !CGPDFArrayGetNumber(font, 1, &size) || !isfinite(size))) failure = "invalid";
}
static void paintObject(CGPDFScannerRef scanner, void *info) {
    countOperator(scanner, info);
    const char *name;
    if (!CGPDFScannerPopName(scanner, &name) || !CGPDFContentStreamGetResource(CGPDFScannerGetContentStream(scanner), "XObject", name)) failure = "invalid";
}
static void inlineImage(CGPDFScannerRef scanner, void *info) {
    countOperator(scanner, info);
    CGPDFStreamRef stream;
    if (!CGPDFScannerPopStream(scanner, &stream)) failure = "invalid";
    else checkImage(stream);
}
static bool canvas(CGRect box, size_t *w, size_t *h) {
    double x = box.size.width, y = box.size.height;
    if (!isfinite(x) || !isfinite(y) || x <= 0 || y <= 0 || x > 14400 || y > 14400) return false;
    double scale = MIN(1.5, MIN(2048/x, MIN(2048/y, sqrt(4000000/(x*y)))));
    *w = MAX(1, (size_t)floor(x*scale)); *h = MAX(1, (size_t)floor(y*scale));
    return true;
}
static bool writeBytes(const void *bytes, size_t size) {
    const uint8_t *p = bytes;
    while (size) { ssize_t n = write(STDOUT_FILENO, p, size); if (n <= 0) return false; p += n; size -= n; }
    return true;
}
int MFDocumentPreviewWorker(size_t page) {
    // Framework diagnostics are uncontrolled; never send document text to logs.
    int quiet = open("/dev/null", O_WRONLY);
    if (quiet < 0 || dup2(quiet, STDERR_FILENO) < 0) return 2;
    close(quiet);
    if (!isolate()) return 2;
    @autoreleasepool {
        uint8_t *input = calloc(inputLimit + 1, 1);
        if (!input) return 2;
        size_t length = 0;
        while (length <= inputLimit) {
            ssize_t n = read(STDIN_FILENO, input + length, inputLimit + 1 - length);
            if (n < 0) { failure = "invalid"; break; }
            if (!n) break;
            length += n;
        }
        uint8_t *pixels = NULL;
        size_t width = 0, height = 0, pages = 0;
        if (length > inputLimit || page == 0 || page > 500) failure = "limit";
        // The autoreleasepool drains PDFKit-owned objects before wiping the
        // original application-owned allocation. OS/framework caches are not
        // claimed to be explicitly zeroized.
        @autoreleasepool {
            NSData *data = [[NSData alloc] initWithBytesNoCopy:input length:length freeWhenDone:NO];
            PDFDocument *pdf = failure ? nil : [[PDFDocument alloc] initWithData:data];
            if (!failure && (!pdf || pdf.isEncrypted || pdf.isLocked)) failure = "invalid";
            pages = pdf.pageCount;
            if (!failure && (pages == 0 || pages > 500 || page > pages)) failure = "limit";
            visited = [NSMutableSet new]; active = [NSMutableSet new];
            for (size_t n = 0; n < pages && !failure; n++) {
                pageImagePixels = 0;
                [visited removeAllObjects];
                PDFPage *p = [pdf pageAtIndex:n];
                CGPDFPageRef cg = p.pageRef;
                size_t w, h;
                if (!cg || !canvas([p boundsForBox:kPDFDisplayBoxMediaBox], &w, &h)) { failure = "limit"; break; }
                CGPDFDictionaryRef dict = CGPDFPageGetDictionary(cg);
                checkDictionary(dict, 0);
                // Resources are inheritable page attributes. Validate the first
                // effective dictionary, not only the page's direct entries.
                CGPDFDictionaryRef ancestor = dict;
                for (size_t depth = 0; ancestor && !failure; depth++) {
                    if (depth > 32) { failure = "limit"; break; }
                    CGPDFObjectRef resources;
                    if (CGPDFDictionaryGetObject(ancestor, "Resources", &resources)) {
                        walk(resources, 0); break;
                    }
                    CGPDFDictionaryRef parent = NULL;
                    CGPDFDictionaryGetDictionary(ancestor, "Parent", &parent);
                    ancestor = parent;
                }
                CGPDFContentStreamRef content = CGPDFContentStreamCreateWithPage(cg);
                CFArrayRef streams = CGPDFContentStreamGetStreams(content);
                for (CFIndex i = 0; i < CFArrayGetCount(streams) && !failure; i++) {
                    CGPDFDataFormat format;
                    CFDataRef bytes = copyStream((CGPDFStreamRef)CFArrayGetValueAtIndex(streams, i), &format);
                    if (bytes) CFRelease(bytes);
                }
                CGPDFOperatorTableRef table = CGPDFOperatorTableCreate();
                const char *ops[] = {"q","Q","cm","w","J","j","M","d","ri","i","gs","m","l","c","v","y","h","re","S","s","f","F","f*","B","B*","b","b*","n","W","W*","BT","ET","Tc","Tw","Tz","TL","Tf","Tr","Ts","Td","TD","Tm","T*","Tj","TJ","'","\"","d0","d1","CS","cs","SC","SCN","sc","scn","G","g","RG","rg","K","k","sh","BI","ID","Do","MP","DP","BMC","BDC","EMC","BX","EX",NULL};
                for (const char **op = ops; *op; op++) CGPDFOperatorTableSetCallback(table, *op, countOperator);
                CGPDFOperatorTableSetCallback(table, "Do", paintObject);
                CGPDFOperatorTableSetCallback(table, "EI", inlineImage);
                CGPDFOperatorTableSetCallback(table, "Tf", selectFont);
                CGPDFOperatorTableSetCallback(table, "Tj", showText);
                CGPDFOperatorTableSetCallback(table, "TJ", showTextArray);
                CGPDFOperatorTableSetCallback(table, "'", showText);
                CGPDFOperatorTableSetCallback(table, "\"", spacedText);
                CGPDFOperatorTableSetCallback(table, "q", saveTextState);
                CGPDFOperatorTableSetCallback(table, "Q", restoreTextState);
                CGPDFOperatorTableSetCallback(table, "gs", graphicsTextState);
                __attribute__((objc_precise_lifetime)) NSMutableArray<NSValue *> *stack = [NSMutableArray new];
                __attribute__((objc_precise_lifetime)) NSMutableDictionary<NSValue *, NSValue *> *fonts = [NSMutableDictionary new];
                struct TextUse text = {.stack = stack, .fonts = fonts};
                CGPDFScannerRef scanner = CGPDFScannerCreate(content, table, &text);
                if (!failure && !CGPDFScannerScan(scanner)) failure = "invalid";
                for (NSValue *value in fonts.allValues) {
                    struct FontUse *use = value.pointerValue;
                    if (use->embedded) CGFontRelease(use->embedded);
                    memset_s(use, sizeof(*use), 0, sizeof(*use)); free(use);
                }
                CGPDFScannerRelease(scanner); CGPDFOperatorTableRelease(table); CGPDFContentStreamRelease(content);
            }
            if (!failure) {
                PDFPage *p = [pdf pageAtIndex:page-1];
                CGRect box = [p boundsForBox:kPDFDisplayBoxMediaBox];
                if (!canvas(box, &width, &height)) failure = "limit";
                else {
                    pixels = calloc(width * height, 4);
                    CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
                    CGContextRef ctx = pixels ? CGBitmapContextCreate(pixels, width, height, 8, width*4, color, kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst) : NULL;
                    CGColorSpaceRelease(color);
                    if (!ctx) failure = "engine";
                    else {
                        CGContextSetRGBFillColor(ctx, 1, 1, 1, 1); CGContextFillRect(ctx, CGRectMake(0,0,width,height));
                        CGContextScaleCTM(ctx, width/box.size.width, height/box.size.height);
                        CGContextTranslateCTM(ctx, -box.origin.x, -box.origin.y);
                        [p drawWithBox:kPDFDisplayBoxMediaBox toContext:ctx];
                        CGContextRelease(ctx);
                    }
                }
            }
            visited = nil; active = nil;
        }
        memset_s(input, inputLimit + 1, 0, inputLimit + 1); free(input);
        char header[256];
        if (failure) snprintf(header,sizeof(header),"{\"error\":\"%s\"}\n",failure);
        else snprintf(header,sizeof(header),"{\"width\":%zu,\"height\":%zu,\"pages\":%zu,\"page\":%zu}\n",width,height,pages,page);
        bool ok = writeBytes(header, strlen(header));
        if (!failure && ok) ok = writeBytes(pixels, width*height*4);
        if (pixels) { memset_s(pixels, width*height*4, 0, width*height*4); free(pixels); }
        return ok ? 0 : 2;
    }
}
#ifdef MF_PDF_TEST_MAIN
int main(int argc, char **argv) { return MFDocumentPreviewWorker(argc > 1 ? strtoul(argv[1],NULL,10) : 1); }
#endif
