#import <AppKit/AppKit.h>

double mf_preferred_text_scale(void) {
    @autoreleasepool {
        NSFont *font = [NSFont preferredFontForTextStyle:NSFontTextStyleBody options:@{}];
        CGFloat base = NSFont.systemFontSize;
        return base > 0 ? MAX(1.0, font.pointSize / base) : 1.0;
    }
}
unsigned int mf_accessibility_preferences(void) {
    @autoreleasepool {
        NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
        return (workspace.accessibilityDisplayShouldIncreaseContrast ? 1u : 0u)
            | (workspace.accessibilityDisplayShouldReduceMotion ? 2u : 0u)
            | (workspace.accessibilityDisplayShouldReduceTransparency ? 4u : 0u);
    }
}
