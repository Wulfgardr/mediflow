'use client';

import { useState, useEffect, useRef } from 'react';
import OpenAI from "openai";
import { Send, Bot, User, Loader2, Sparkles, AlertTriangle, Paperclip, X, Image as ImageIcon, FileText, Plus, MessageSquare, Info, Cpu, Zap, Clock, Activity, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { cn } from '@/lib/utils';
import { db, Conversation, Message as DbMessage } from '@/lib/db'; // Make sure interfaces are exported
import { useLiveQuery } from 'dexie-react-hooks';
import ReactMarkdown from 'react-markdown';
import { fileToBase64, isImageFile, isTextDocument, extractTextFromFile } from '@/lib/ai/file-parsers';
import { v4 as uuidv4 } from 'uuid';

// Interface for UI state (extends DB message with loading state if needed)
interface UIMessage extends DbMessage {
    isTyping?: boolean;
}

export default function AssistantPage() {
    // --- State ---
    const [engine, setEngine] = useState<OpenAI | null>(null);
    const [isModelLoading, setIsModelLoading] = useState(false);

    // Conversation State
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<UIMessage[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [showNerdStats, setShowNerdStats] = useState(false);
    const [showArchived, setShowArchived] = useState(false);

    // Attachments
    const [attachment, setAttachment] = useState<File | null>(null);
    const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);

    // Sidebar
    const conversations = useLiveQuery(() => db.conversations.orderBy('updatedAt').reverse().toArray());
    const patients = useLiveQuery(() => db.patients.toArray());

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Effects ---

    useEffect(() => {
        initEngine();
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    // Load messages when active conversation changes
    useEffect(() => {
        if (activeConversationId) {
            loadMessages(activeConversationId);
        } else {
            setMessages([]);
        }
    }, [activeConversationId]);

    // --- Engine & Logic ---

    const initEngine = async () => {
        try {
            const openai = await import('@/lib/ai-engine').then(m => m.getAiEngine());
            setEngine(openai);
        } catch (err) {
            console.error(err);
        }
    };

    const loadMessages = async (conversationId: string) => {
        const stored = await db.messages.where('conversationId').equals(conversationId).sortBy('createdAt');
        setMessages(stored);
    };

    const startNewChat = async () => {
        const newId = uuidv4();
        const id = await db.conversations.add({
            id: newId,
            title: "Nuova Conversazione",
            updatedAt: new Date(),
            createdAt: new Date()
        });
        setActiveConversationId(newId);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (isImageFile(file)) {
            const base64 = await fileToBase64(file);
            setAttachment(file);
            setAttachmentPreview(base64);
        } else if (isTextDocument(file)) {
            setAttachment(file);
            setAttachmentPreview(null); // No preview for text docs yet
        } else {
            alert("Formato file non supportato. Usa Immagini o PDF/Testo.");
        }
    };

    const deleteConversation = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm("Sei sicuro di voler eliminare questa chat definitivamente?")) return;

        await db.messages.where('conversationId').equals(id).delete();
        await db.conversations.delete(id);

        if (activeConversationId === id) {
            setActiveConversationId(null);
            setMessages([]);
        }
    };

    const toggleArchive = async (e: React.MouseEvent, conversation: Conversation) => {
        e.stopPropagation();
        await db.conversations.update(conversation.id, { isArchived: !conversation.isArchived });
    };

    const clearAttachment = () => {
        setAttachment(null);
        setAttachmentPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const sendMessage = async () => {
        if ((!input.trim() && !attachment) || !engine) return;

        let conversationId = activeConversationId;
        if (!conversationId) {
            conversationId = uuidv4();
            await db.conversations.add({
                id: conversationId,
                title: input.slice(0, 30) + "...",
                updatedAt: new Date(),
                createdAt: new Date()
            });
            setActiveConversationId(conversationId);
        }

        // Prepare User Message
        const userMsgId = uuidv4();
        let attachmentData: string | undefined = undefined;
        let attachmentType: 'image' | 'file' | undefined = undefined;

        if (attachment) {
            if (isImageFile(attachment)) {
                attachmentData = await fileToBase64(attachment); // Full base64 for display/storage
                attachmentType = 'image';
            } else {
                // For text files, we extract content now
                attachmentData = await extractTextFromFile(attachment);
                attachmentType = 'file';
            }
        }

        const newUserMsg: DbMessage = {
            id: userMsgId,
            conversationId,
            role: 'user',
            content: input,
            attachmentBase64: attachmentData,
            attachmentType: attachmentType,
            createdAt: new Date()
        };

        // Optimistic Update
        setMessages(prev => [...prev, newUserMsg]);
        setInput("");
        clearAttachment();
        setIsLoading(true);

        // Save User Message
        await db.messages.add(newUserMsg);
        await db.conversations.update(conversationId, { updatedAt: new Date(), title: messages.length === 0 ? input.slice(0, 30) + "..." : undefined }); // First msg sets title

        try {
            // Build Context & Prompt
            const context = await buildContext(input);

            // Construct payload for OpenAI SDK
            // Note: If image, we need special "content" array format
            const messagesPayload = messages.concat(newUserMsg).map(m => {
                if (m.attachmentType === 'image' && m.attachmentBase64) {
                    return {
                        role: m.role,
                        content: [
                            { type: "text", text: m.content },
                            { type: "image_url", image_url: { url: m.attachmentBase64 } }
                        ]
                    };
                }
                if (m.attachmentType === 'file' && m.attachmentBase64) {
                    return {
                        role: m.role,
                        content: `${m.content}\n\n--- ALLEGATO (${m.attachmentType}) ---\n${m.attachmentBase64}`
                    };
                }
                return { role: m.role, content: m.content };
            });

            // Inject Context into the LAST user message for the model
            if (context && messagesPayload.length > 0) {
                const lastMsgIdx = messagesPayload.length - 1;
                const lastMsg = messagesPayload[lastMsgIdx];
                if (lastMsg.role === 'user') {
                    if (Array.isArray(lastMsg.content)) {
                        // Multimodal (Image + Text)
                        const textPart = lastMsg.content.find((c: any) => c.type === 'text');
                        if (textPart) {
                            textPart.text = `${textPart.text}\n\n${context}`;
                        }
                    } else {
                        // Text only
                        lastMsg.content = `${lastMsg.content}\n\n${context}`;
                    }
                }
            }

            // Add system prompt if start
            const systemMsg = {
                role: "system",
                content: `Sei MedAssistant AI.
CONNESSIONE DATABASE: ATTIVA.
CONTESTO PAZIENTE: Se presente nel messaggio seguente, DEVI usarlo. Non dire mai "non ho accesso ai dati" se i dati sono nel testo del prompt.
FORMATO: Rispondi in italiano preciso. Usa Markdown.
`
            };

            const startTime = performance.now();
            const response = await engine.chat.completions.create({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                messages: [systemMsg, ...messagesPayload] as any,
                model: "hf.co/unsloth/medgemma-1.5-4b-it-GGUF",
            });
            const endTime = performance.now();
            const latency = Math.round(endTime - startTime);

            let replyContent = response.choices[0].message.content || "Nessuna risposta.";
            const usage = response.usage;

            // Parse out Chain of Thought (<unused94>...<unused95>)
            let reasoning = "";
            const thoughtMatch = replyContent.match(/<unused94>([\s\S]*?)<unused95>/);
            if (thoughtMatch) {
                reasoning = thoughtMatch[1].trim();
                replyContent = replyContent.replace(/<unused94>[\s\S]*?<unused95>/, '').trim();
            }

            const assistMsgId = uuidv4();
            const newAssistMsg: DbMessage = {
                id: assistMsgId,
                conversationId,
                role: 'assistant',
                content: replyContent,
                metadata: {
                    latencyMs: latency,
                    tokensIn: usage?.prompt_tokens,
                    tokensOut: usage?.completion_tokens,
                    model: response.model,
                    reasoning: reasoning,
                    // Store context usage for debugging
                    contextUsed: context ? "YES" : "NO"
                },
                createdAt: new Date()
            };

            setMessages(prev => [...prev, newAssistMsg]);
            await db.messages.add(newAssistMsg);

        } catch (err) {
            console.error(err);
            setMessages(prev => [...prev, {
                id: uuidv4(), conversationId: conversationId!, role: 'assistant', content: "Errore generazione risposta.", createdAt: new Date()
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    // Helper to find patient mentions and inject context
    const buildContext = async (text: string) => {
        // Fetch fresh patients list directly to avoid stale closures
        const allPatients = await db.patients.toArray();

        const lowercaseInput = text.toLowerCase();
        // Simple name matching strategy
        const matchedPatient = allPatients.find(p =>
            lowercaseInput.includes(p.firstName.toLowerCase()) ||
            lowercaseInput.includes(p.lastName.toLowerCase())
        );

        if (!matchedPatient) {
            console.log("No patient matched in input:", text);
            return "";
        }

        console.log("Matched Patient:", matchedPatient.lastName);

        // 1. Fetch Latest Clinical Entries (Diary)
        const entries = await db.entries
            .where('patientId')
            .equals(matchedPatient.id)
            .reverse()
            .limit(5)
            .toArray();

        const diaryContext = entries
            .map(e => `[${e.date.toLocaleDateString()}] ${e.type.toUpperCase()}: ${e.content}`)
            .join("\n");

        // 2. Fetch Active Therapies
        const therapies = await db.therapies
            .where('patientId')
            .equals(matchedPatient.id)
            .filter(t => t.status === 'active')
            .toArray();

        const therapyContext = therapies
            .map(t => `- ${t.drugName} ${t.dosage}`)
            .join("\n");

        // 3. Fetch Recent Attachments (Summaries)
        const attachments = await db.attachments
            .where('patientId')
            .equals(matchedPatient.id)
            .reverse()
            .limit(5)
            .toArray();

        const docsContext = attachments
            .filter(a => a.summarySnapshot)
            .map(a => `[DOC ${a.name}]: ${a.summarySnapshot}`)
            .join("\n");

        return `
--- CONTESTO PAZIENTE TROVATO ---
Nome: ${matchedPatient.firstName} ${matchedPatient.lastName}
Età: ${matchedPatient.birthDate ? new Date().getFullYear() - matchedPatient.birthDate.getFullYear() : 'N/A'}

[TERAPIA ATTIVA]
${therapyContext || "Nessuna terapia registrata."}

[ULTIME NOTE CLINICHE]
${diaryContext || "Nessuna nota recente."}

[DOCUMENTI RECENTI]
${docsContext || "Nessun documento analizzato."}
--- FINE CONTESTO ---
Usa queste informazioni se pertinenti alla richiesta.
`;
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const formatDate = (d: Date) => {
        return new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(d);
    };

    return (
        <div className="flex h-[calc(100vh-2rem)] gap-4">
            {/* Sidebar History */}
            <div className="w-64 glass-panel flex flex-col p-2 hidden md:flex shrink-0">
                <button
                    onClick={startNewChat}
                    className="flex items-center gap-2 w-full p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-bold shadow-md mb-4"
                >
                    <Plus className="w-5 h-5" />
                    Nuova Chat
                </button>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    <div className="flex items-center justify-between px-2 mb-2">
                        <span className="text-xs font-bold text-gray-400 uppercase">
                            {showArchived ? "Archivio" : "Recenti"}
                        </span>
                        <button
                            onClick={() => setShowArchived(!showArchived)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors"
                        >
                            {showArchived ? <MessageSquare className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                            {showArchived ? "Chat Attive" : "Archivio"}
                        </button>
                    </div>

                    {conversations?.filter(c => showArchived ? c.isArchived : !c.isArchived).map(c => (
                        <div
                            key={c.id}
                            className={cn(
                                "group w-full text-left p-3 rounded-xl text-sm transition-all border flex items-start justify-between relative",
                                activeConversationId === c.id
                                    ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-medium shadow-sm"
                                    : "hover:bg-gray-50 border-transparent text-gray-600"
                            )}
                            onClick={() => setActiveConversationId(c.id)}
                        // role="button" removed to avoid nesting interactive controls warning
                        >
                            <div className="flex-1 min-w-0 pr-6">
                                <div className="truncate font-medium">{c.title}</div>
                                <div className="text-[10px] text-gray-400 mt-1">{c.updatedAt.toLocaleDateString()}</div>
                            </div>

                            <div className="absolute right-2 top-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-0.5 shadow-sm">
                                <button
                                    onClick={(e) => toggleArchive(e, c)}
                                    className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
                                    title={c.isArchived ? "Ripristina" : "Archivia"}
                                >
                                    {c.isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                    onClick={(e) => deleteConversation(e, c.id)}
                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md"
                                    title="Elimina definitivamente"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                    {conversations?.filter(c => showArchived ? c.isArchived : !c.isArchived).length === 0 && (
                        <div className="text-center text-gray-400 text-sm py-10 opacity-60">
                            {showArchived ? "Nessuna chat archiviata" : "Nessuna conversazione recente"}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 glass-panel flex flex-col relative overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white/50 backdrop-blur-sm z-30">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-lg shadow-md">
                            <Bot className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="font-bold text-gray-800">MedAssistant Pro</h2>
                            <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                                {engine ? <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /> : <span className="w-2 h-2 bg-amber-500 rounded-full" />}
                                {engine ? "Online (MedGemma 1.5)" : "Connessione..."}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowNerdStats(!showNerdStats)}
                        className={cn("p-2 rounded-lg transition-all", showNerdStats ? "bg-indigo-100 text-indigo-700" : "text-gray-400 hover:bg-gray-100")}
                        title="Dati Tecnici Modello"
                    >
                        <Activity className="w-5 h-5" />
                    </button>
                </div>

                {/* Nerd Stats Overlay */}
                {showNerdStats && (
                    <div className="absolute top-16 right-4 z-40 bg-white/90 backdrop-blur-md p-4 rounded-xl shadow-xl border border-indigo-100 w-64 animate-in slide-in-from-top-2 fade-in text-xs space-y-3">
                        <div className="flex items-center gap-2 text-indigo-700 font-bold border-b border-indigo-50 pb-2">
                            <Cpu className="w-4 h-4" />
                            Performance Monitor
                        </div>
                        {messages.filter(m => m.role === 'assistant').slice(-1).map(lastMsg => (
                            <div key={lastMsg.id} className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Latenza:</span>
                                    <span className="font-mono font-medium text-gray-800">{lastMsg.metadata?.latencyMs || '-'} ms</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Tokens Input:</span>
                                    <span className="font-mono font-medium text-gray-800">{lastMsg.metadata?.tokensIn || '-'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Tokens Output:</span>
                                    <span className="font-mono font-medium text-gray-800">{lastMsg.metadata?.tokensOut || '-'}</span>
                                </div>
                                <div className="flex justify-between items-center text-green-600 bg-green-50 p-1.5 rounded">
                                    <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> TPS Est.:</span>
                                    <span className="font-mono font-bold">
                                        {lastMsg.metadata?.tokensOut && lastMsg.metadata?.latencyMs
                                            ? Math.round((lastMsg.metadata.tokensOut / (lastMsg.metadata.latencyMs / 1000)) * 10) / 10
                                            : '-'}
                                    </span>
                                </div>

                                {lastMsg.metadata?.reasoning && (
                                    <div className="mt-2 pt-2 border-t border-indigo-50">
                                        <p className="text-[10px] text-indigo-400 mb-1 flex items-center gap-1"><Cpu className="w-3 h-3" /> Chain of Thought:</p>
                                        <div className="max-h-32 overflow-y-auto bg-gray-50 p-1.5 rounded text-[10px] font-mono leading-tight text-gray-600">
                                            {lastMsg.metadata.reasoning}
                                        </div>
                                    </div>
                                )}

                                <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
                                    <span className="text-gray-400">Context:</span>
                                    <span className={cn("font-bold", lastMsg.metadata?.contextUsed === "YES" ? "text-green-600" : "text-gray-400")}>
                                        {lastMsg.metadata?.contextUsed || "NO"}
                                    </span>
                                </div>
                            </div>
                        ))}
                        {messages.filter(m => m.role === 'assistant').length === 0 && (
                            <div className="text-gray-400 italic text-center py-2">Invia un messaggio per vedere le statistiche.</div>
                        )}
                    </div>
                )}

                {/* Messages List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-gray-50/30">
                    {messages.length === 0 && !activeConversationId && (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
                            <MessageSquare className="w-16 h-16 mb-4" />
                            <p>Seleziona una chat o iniciane una nuova.</p>
                        </div>
                    )}

                    {messages.map((msg) => (
                        <div key={msg.id} className={cn("flex gap-4 max-w-3xl", msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto")}>
                            {/* Avatar */}
                            <div className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm border-2 border-white",
                                msg.role === 'user' ? "bg-gray-200 text-gray-600" : "bg-indigo-600 text-white"
                            )}>
                                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                            </div>

                            {/* Bubble */}
                            <div className={cn(
                                "flex flex-col gap-1 min-w-0",
                                msg.role === 'user' ? "items-end" : "items-start"
                            )}>
                                <div className={cn(
                                    "p-4 rounded-2xl shadow-sm leading-relaxed max-w-full overflow-hidden text-sm",
                                    msg.role === 'user'
                                        ? "bg-indigo-600 text-white rounded-br-none"
                                        : "bg-white text-gray-800 border border-gray-100 rounded-bl-none"
                                )}>
                                    {/* Attachment Display */}
                                    {msg.attachmentType === 'image' && msg.attachmentBase64 && (
                                        <div className="mb-3 rounded-lg overflow-hidden border border-white/20">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={msg.attachmentBase64} alt="Allegato" className="max-w-xs max-h-60 object-cover" />
                                        </div>
                                    )}
                                    {msg.attachmentType === 'file' && (
                                        <div className="mb-3 flex items-center gap-2 bg-black/10 p-2 rounded text-xs font-mono">
                                            <FileText className="w-4 h-4" /> Contenuto File Estratto
                                        </div>
                                    )}

                                    <div className={cn("prose prose-sm max-w-none", msg.role === 'user' ? "prose-invert" : "text-gray-700")}>
                                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                                    </div>
                                </div>
                                <span className="text-[10px] text-gray-400 px-1">{formatDate(msg.createdAt)}</span>
                            </div>
                        </div>
                    ))}

                    {/* Typing Indicator */}
                    {isLoading && (
                        <div className="flex gap-4 max-w-3xl mr-auto animate-pulse">
                            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                                <Bot className="w-4 h-4" />
                            </div>
                            <div className="p-4 rounded-2xl bg-white shadow-sm border border-gray-100 flex items-center gap-1">
                                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></div>
                                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-75"></div>
                                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-150"></div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-white border-t border-gray-100 relative z-20">
                    {/* Attachment Preview */}
                    {attachment && (
                        <div className="absolute bottom-full left-4 mb-2 bg-white p-2 rounded-xl shadow-lg border border-indigo-100 flex items-center gap-3 animate-in slide-in-from-bottom-2 fade-in">
                            {attachmentPreview ? (
                                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden relative">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={attachmentPreview} className="w-full h-full object-cover" alt="Preview" />
                                </div>
                            ) : (
                                <div className="w-12 h-12 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                                    <FileText className="w-6 h-6" />
                                </div>
                            )}
                            <div className="mr-2">
                                <p className="text-xs font-bold text-gray-700 truncate max-w-[150px]">{attachment.name}</p>
                                <p className="text-[10px] text-gray-400">{Math.round(attachment.size / 1024)} KB</p>
                            </div>
                            <button
                                onClick={clearAttachment}
                                className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500 transition-colors"
                                title="Rimuovi allegato"
                                aria-label="Rimuovi allegato"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    <div className="flex gap-2 items-end">
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept="image/*,.pdf,.txt,.md,.csv"
                            onChange={handleFileUpload}
                            aria-label="Carica file" // Accessibility fix
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="p-3 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                            title="Allega file o immagine"
                        >
                            <Paperclip className="w-5 h-5" />
                        </button>

                        <div className="flex-1 bg-gray-50 border border-gray-200 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10 rounded-2xl flex items-center transition-all">
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                                placeholder="Scrivi un messaggio..."
                                disabled={!engine || isLoading}
                                className="flex-1 bg-transparent border-0 focus:ring-0 px-4 py-3 min-h-[50px] max-h-[150px] text-sm font-medium placeholder:text-gray-400"
                            />
                        </div>

                        <button
                            onClick={sendMessage}
                            disabled={!engine || isLoading || (!input.trim() && !attachment)}
                            className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:grayscale transition-all shadow-md shadow-indigo-600/20 active:scale-95"
                            title="Invia messaggio"
                            aria-label="Invia messaggio"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                    </div>
                    <p className="text-[10px] text-center mt-2 text-gray-400 flex items-center justify-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                        L&apos;IA può commettere errori. Verifica sempre le informazioni mediche.
                    </p>
                </div>
            </div>
        </div>
    );
}
