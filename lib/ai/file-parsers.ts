/**
 * Utility to convert a File object to a Base64 string.
 * Useful for sending images to LLMs (Multimodal).
 */
export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
    });
};

/**
 * Validates if the file is a supported image type for vision models.
 */
export const isImageFile = (file: File): boolean => {
    return file.type.startsWith('image/');
};

/**
 * Validates if the file is a PDF or text file suitable for text extraction.
 */
export const isTextDocument = (file: File): boolean => {
    return file.type === 'application/pdf' || file.type.startsWith('text/');
};

/**
 * Simple text extractor.
 * NOTE: For robust PDF extraction in browser, we might need pdf.js. 
 * For now, this handles plain text. If PDF is needed, we will add pdfjs-dist.
 */
export const extractTextFromFile = async (file: File): Promise<string> => {
    if (file.type.startsWith('text/')) {
        return await file.text();
    }

    // Placeholder for PDF parsing logic
    // Implementing usage of pdfjs-dist would go here if installed.
    // For now we assume the user might paste content or use text files.
    if (file.type === 'application/pdf') {
        return `[PDF Content Placeholder: ${file.name} - Parsing not yet implemented, please rely on text files for now]`;
    }

    return "";
};
