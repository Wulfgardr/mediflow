'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Sparkles, AlertTriangle, Paperclip, X, FileText, Plus, MessageSquare, Archive, ArchiveRestore, Activity, Trash2, Cpu, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { db, Conversation, Message as DbMessage } from '@/lib/db';

import ReactMarkdown from 'react-markdown';
import { fileToBase64, isImageFile, isTextDocument, extractTextFromFile } from '@/lib/ai/file-parsers';
import { v4 as uuidv4 } from 'uuid';

interface UIMessage {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    createdAt: Date;
    metadata?: string;
    isTyping?: boolean;
    attachmentType?: string;
    attachmentBase64?: string;
}

export default function AssistantPage() {
    // Conversation State
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<UIMessage[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [showNerdStats, setShowNerdStats] = useState(false);

    // Attachments
    const [attachment, setAttachment] = useState<File | null>(null);

    // Sidebar Data
    const [conversationsList, setConversationsList] = useState<Conversation[]>([]);
    const [patientsList, setPatientsList] = useState<any[]>([]);

    // Helper to refresh conversations list from DB
    const refreshConversations = async () => {
        const convs = await db.conversations.toArray();
        setConversationsList(convs.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    };

    useEffect(() => {
        const loadData = async () => {
            await refreshConversations();
            const pats = await db.patients.toArray();
            setPatientsList(pats);
        };
        loadData();
        // Poll every 5 seconds for updates (poor man's live query)
        const interval = setInterval(loadData, 5000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const conversations = conversationsList;
    const patients = patientsList;

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Tagging State ---
    const [showTagMenu, setShowTagMenu] = useState(false);
    const [tagQuery, setTagQuery] = useState("");
    const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
    const [selectedPatientName, setSelectedPatientName] = useState<string | null>(null);

    // --- Effects ---
    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    useEffect(() => {
        if (activeConversationId) {
            loadMessages(activeConversationId);
        } else {
            setMessages([]);
        }
    }, [activeConversationId]);

    // Tagging Logic: Monitor input for '@'
    useEffect(() => {
        const lastWord = input.split(' ').pop();
        if (lastWord && lastWord.startsWith('@')) {
            setTagQuery(lastWord.slice(1)); // Remove the @
            setShowTagMenu(true);
        } else {
            setShowTagMenu(false);
        }
    }, [input]);

    // --- Engine & Logic ---
    // No explicit init needed for Service pattern, handled per-call or lazy loaded.

    const loadMessages = async (conversationId: string) => {
        const allMessages = await db.messages.toArray();
        const stored = allMessages
            .filter((m: any) => m.conversationId === conversationId)
            .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        setMessages(stored);
    };

    const startNewChat = async () => {
        const newId = uuidv4();
        await db.conversations.add({ id: newId, title: "Nuova Conversazione", updatedAt: new Date(), createdAt: new Date() });
        setActiveConversationId(newId);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (isImageFile(file)) {
            setAttachment(file);
        } else if (isTextDocument(file)) {
            setAttachment(file);
        } else {
            alert("Formato file non supportato.");
        }
    };

    // --- Folder Logic ---
    const [viewMode, setViewMode] = useState<'active' | 'archived' | 'trash'>('active');

    const deleteConversation = async (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        const conv = conversationsList.find(c => c.id === id);
        if (!conv) return;

        if (viewMode === 'trash') {
            if (!confirm("Sei sicuro di voler eliminare questa chat definitivamente?")) return;
            // Delete associated messages first
            const allMessages = await db.messages.toArray();
            const messagesToDelete = allMessages.filter((m: { conversationId: string }) => m.conversationId === id);
            await db.messages.bulkDelete(messagesToDelete.map((m: { id: string }) => m.id));
            // Then delete the conversation
            await db.conversations.delete(id);
        }

        // Deselect if this was the active conversation
        if (activeConversationId === id) {
            setActiveConversationId(null);
            setMessages([]);
        }

        await refreshConversations();
    };

    // Schema check required. Let's look at `lib/db.ts` first before applying complex logic.
    // Assuming for now we only have `isArchived`. I will implement "Trash" as `isDeleted` flag in DB.

    const moveToTrash = async (e: React.MouseEvent, conversation: Conversation) => {
        e.preventDefault();
        e.stopPropagation();
        await db.conversations.update(conversation.id, { isDeleted: true, isArchived: false });

        // Deselect if this was the active conversation
        if (activeConversationId === conversation.id) {
            setActiveConversationId(null);
            setMessages([]);
        }

        await refreshConversations();
    };

    const restoreFromTrash = async (e: React.MouseEvent, conversation: Conversation) => {
        e.preventDefault();
        e.stopPropagation();
        await db.conversations.update(conversation.id, { isDeleted: false });
        await refreshConversations();
    };

    const toggleArchive = async (e: React.MouseEvent, conversation: Conversation) => {
        e.preventDefault();
        e.stopPropagation();
        await db.conversations.update(conversation.id, { isArchived: !conversation.isArchived, isDeleted: false });

        // Deselect if archiving the active conversation
        if (activeConversationId === conversation.id && !conversation.isArchived) {
            setActiveConversationId(null);
            setMessages([]);
        }

        await refreshConversations();
    };

    const clearAttachment = () => {
        setAttachment(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // --- Tagging Handlers ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selectPatientTag = (patient: any) => {
        const words = input.split(' ');
        words.pop(); // Remove the partial @tag
        const newText = words.join(' ') + ` @${patient.lastName} `; // Add full name and space
        setInput(newText);
        setSelectedPatientId(patient.id);
        setSelectedPatientName(`${patient.lastName} ${patient.firstName}`);
        setShowTagMenu(false);
        // Focus back on input (optional, referencing input ref would be better)
    };

    const sendMessage = async () => {
        if ((!input.trim() && !attachment)) return;

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

        const userMsgId = uuidv4();
        let attachmentData: string | undefined = undefined;
        let attachmentType: 'image' | 'file' | undefined = undefined;

        if (attachment) {
            if (isImageFile(attachment)) {
                attachmentData = await fileToBase64(attachment);
                attachmentType = 'image';
            } else {
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

        const updatedMessages = [...messages, newUserMsg];
        setMessages(updatedMessages);
        setInput("");
        clearAttachment();
        setIsLoading(true);

        // Context Handling
        const currentPatientId = selectedPatientId;
        // Clean up UI selections
        setSelectedPatientId(null);
        setSelectedPatientName(null);

        await db.messages.add(newUserMsg);
        await db.conversations.update(conversationId, { updatedAt: new Date() });

        try {
            // Import Service & Prompts dynamically
            const { AIService } = await import('@/lib/ai-service');
            const { AIPrompts } = await import('@/lib/ai-prompts');
            const { buildPatientContext, findAndBuildSmartContext } = await import('@/lib/ai-context');

            const service = await AIService.create();

            // 1. Build Context
            let contextString = "";
            let contextSource = "NONE";

            if (currentPatientId) {
                // Explicit Tag
                contextString = await buildPatientContext(currentPatientId);
                contextSource = "TAG";
            } else {
                // Implicit Search
                const smartResult = await findAndBuildSmartContext(newUserMsg.content);
                if (smartResult.found) {
                    contextString = smartResult.summary;
                    contextSource = "SMART: " + smartResult.patientName;
                }
            }

            // 2. Prepare Payload
            // Convert DB messages to Ollama format
            const historyPayload = updatedMessages.map(m => {
                let content = m.content;
                // Inject file content into text for the model to "see" it
                if (m.attachmentType === 'file' && m.attachmentBase64) {
                    content += `\n\n[ALLEGATO FILE]:\n${m.attachmentBase64}`;
                }

                // If this is the VERY LAST message (the current one), inject context
                if (m.id === userMsgId && contextString) {
                    content += `\n\n${contextString}`;
                }

                const msgObj: { role: string; content: string; images?: string[] } = {
                    role: m.role,
                    content: content
                };

                // Add images if present
                if (m.attachmentType === 'image' && m.attachmentBase64) {
                    // Ollama expects base64 without header usually, need to check if SDK or API handles it.
                    // Native API expects "images": ["base64..."]
                    // fileToBase64 usually returns "data:image/png;base64,....."
                    // We need to strip the prefix for Ollama API
                    const pureBase64 = m.attachmentBase64.split(',')[1];
                    msgObj.images = [pureBase64];
                }

                return msgObj;
            });

            // Prepend System Prompt
            const finalPayload = [
                { role: "system", content: AIPrompts.SYSTEM_CHAT },
                ...historyPayload
            ];

            // 3. Call Ollama
            const result = await service.chat(finalPayload);

            // 4. Handle Response
            let replyContent = result.content;
            let reasoning = "";

            // Strip Reasoning if present (DeepSeek/R1 style)
            const thoughtMatch = replyContent.match(/<unused94>([\s\S]*?)<unused95>/);
            if (thoughtMatch) {
                reasoning = thoughtMatch[1].trim();
                replyContent = replyContent.replace(/<unused94>[\s\S]*?<unused95>/, '').trim();
            }
            // Strip standard <think> tags too just in case
            replyContent = replyContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();


            const assistMsgId = uuidv4();
            const newAssistMsg: DbMessage = {
                id: assistMsgId,
                conversationId,
                role: 'assistant',
                content: replyContent,
                metadata: JSON.stringify({
                    latencyMs: result.stats.latency,
                    tokensIn: result.stats.tokensIn,
                    tokensOut: result.stats.tokensOut,
                    model: "ollama-native",
                    reasoning: reasoning,
                    contextUsed: contextSource
                }),
                createdAt: new Date()
            };

            setMessages(prev => [...prev, newAssistMsg]);
            await db.messages.add(newAssistMsg);

        } catch (err) {
            console.error(err);
            const errorMsg = "Errore di connessione: Provider AI non risponde. Verifica le Impostazioni.";
            setMessages(prev => [...prev, {
                id: uuidv4(), conversationId: conversationId!, role: 'assistant', content: `⚠️ ${errorMsg}`, createdAt: new Date()
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); };
    const formatDate = (d: Date) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(d);

    // Filter patients for tag menu
    const filteredPatients = patients?.filter(p =>
        p.lastName.toLowerCase().includes(tagQuery.toLowerCase()) ||
        p.firstName.toLowerCase().includes(tagQuery.toLowerCase())
    ).slice(0, 5);

    return (
        <div className="flex h-[calc(100vh-2rem)] gap-4">
            {/* Sidebar History */}
            <div className="w-64 glass-panel flex flex-col p-2 hidden md:flex shrink-0">
                <button onClick={startNewChat} className="flex items-center gap-2 w-full p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-bold shadow-md mb-4 py-3">
                    <Plus className="w-5 h-5" /> Nuova Chat
                </button>

                {/* Filters */}
                <div className="flex p-1 bg-gray-100 rounded-lg mb-4 text-xs font-medium">
                    <button
                        onClick={() => setViewMode('active')}
                        className={cn("flex-1 py-1.5 rounded-md transition-all flex items-center justify-center gap-1", viewMode === 'active' ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700")}
                        title="Chat Attive"
                    >
                        <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => setViewMode('archived')}
                        className={cn("flex-1 py-1.5 rounded-md transition-all flex items-center justify-center gap-1", viewMode === 'archived' ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700")}
                        title="Archivio"
                    >
                        <Archive className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => setViewMode('trash')}
                        className={cn("flex-1 py-1.5 rounded-md transition-all flex items-center justify-center gap-1", viewMode === 'trash' ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700")}
                        title="Cestino"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* History List */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    <div className="px-2 mb-2 text-xs font-bold text-gray-400 uppercase">
                        {viewMode === 'active' && "Recenti"}
                        {viewMode === 'archived' && "Archivio"}
                        {viewMode === 'trash' && "Cestino"}
                    </div>

                    {conversations?.filter(c => {
                        if (viewMode === 'trash') return c.isDeleted;
                        if (viewMode === 'archived') return c.isArchived && !c.isDeleted;
                        return !c.isArchived && !c.isDeleted;
                    }).map(c => (
                        <div key={c.id} onClick={() => setActiveConversationId(c.id)} className={cn("group w-full text-left p-3 rounded-xl text-sm transition-all border flex items-start justify-between relative cursor-pointer", activeConversationId === c.id ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-medium shadow-sm" : "hover:bg-gray-50 border-transparent text-gray-600")}>
                            <div className="flex-1 min-w-0 pr-6">
                                <div className="truncate font-medium">{c.title}</div>
                                <div className="text-[10px] text-gray-400 mt-1">{c.updatedAt.toLocaleDateString()}</div>
                            </div>

                            <div className="absolute right-2 top-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-0.5 shadow-sm">
                                {viewMode === 'trash' ? (
                                    <>
                                        <button onClick={(e) => restoreFromTrash(e, c)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-md" aria-label="Ripristina" title="Ripristina">
                                            <ArchiveRestore className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={(e) => deleteConversation(e, c.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md" aria-label="Elimina Definitivamente" title="Elimina Definitivamente">
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={(e) => toggleArchive(e, c)} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md" aria-label={c.isArchived ? "Ripristina" : "Archivia"} title={c.isArchived ? "Ripristina" : "Archivia"}>
                                            {c.isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                                        </button>
                                        <button onClick={(e) => moveToTrash(e, c)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md" aria-label="Sposta nel cestino" title="Sposta nel cestino">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}

                    {conversations?.filter(c => {
                        if (viewMode === 'trash') return c.isDeleted;
                        if (viewMode === 'archived') return c.isArchived && !c.isDeleted;
                        return !c.isArchived && !c.isDeleted;
                    }).length === 0 && (
                            <div className="text-center text-gray-400 text-sm py-10 opacity-60">
                                {viewMode === 'trash' ? "Cestino vuoto" : viewMode === 'archived' ? "Nessuna chat archiviata" : "Nessuna conversazione recente"}
                            </div>
                        )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 glass-panel flex flex-col relative overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white/50 backdrop-blur-sm z-30">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-lg shadow-md"><Bot className="w-5 h-5" /></div>
                        <div>
                            <h2 className="font-bold text-gray-800">MedAssistant Pro</h2>
                            <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                Online
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
                        {messages.filter(m => m.role === 'assistant').slice(-1).map(lastMsg => {
                            let meta: any = {};
                            try {
                                if (lastMsg.metadata) meta = JSON.parse(lastMsg.metadata);
                            } catch (e) { console.error("Bad metadata JSON", e); }

                            return (
                                <div key={lastMsg.id} className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Latenza:</span>
                                        <span className="font-mono font-medium text-gray-800">{meta?.latencyMs || '-'} ms</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Tokens Input:</span>
                                        <span className="font-mono font-medium text-gray-800">{meta?.tokensIn || '-'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Tokens Output:</span>
                                        <span className="font-mono font-medium text-gray-800">{meta?.tokensOut || '-'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-green-600 bg-green-50 p-1.5 rounded">
                                        <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> TPS Est.:</span>
                                        <span className="font-mono font-bold">
                                            {meta?.tokensOut && meta?.latencyMs
                                                ? Math.round((meta.tokensOut / (meta.latencyMs / 1000)) * 10) / 10
                                                : '-'}
                                        </span>
                                    </div>

                                    {meta?.reasoning && (
                                        <div className="mt-2 pt-2 border-t border-indigo-50">
                                            <p className="text-[10px] text-indigo-400 mb-1 flex items-center gap-1"><Cpu className="w-3 h-3" /> Chain of Thought:</p>
                                            <div className="max-h-32 overflow-y-auto bg-gray-50 p-1.5 rounded text-[10px] font-mono leading-tight text-gray-600">
                                                {meta.reasoning}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
                                        <span className="text-gray-400">Context:</span>
                                        <span className={cn("font-bold", meta?.contextUsed === "YES" ? "text-green-600" : "text-gray-400")}>
                                            {meta?.contextUsed || "NO"}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
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

                    {messages.map((msg) => {
                        let meta: any = {};
                        try {
                            if (msg.metadata) meta = JSON.parse(msg.metadata);
                        } catch (e) {
                            // console.error("Error parsing message metadata", e);
                        }

                        return (
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

                                        {/* Debug Metadata for Assistant */}
                                        {msg.role === 'assistant' && meta?.contextUsed && meta.contextUsed !== 'NONE' && (
                                            <div className="mt-2 pt-2 border-t border-gray-100 text-[10px] text-green-600 flex items-center gap-1 font-mono">
                                                <Sparkles className="w-3 h-3" />
                                                Context: {meta.contextUsed}
                                            </div>
                                        )}
                                    </div>
                                    <span className="text-[10px] text-gray-400 px-1">{formatDate(msg.createdAt)}</span>
                                </div>
                            </div>
                        );
                    })}
                    {isLoading && (
                        <div className="flex gap-4 max-w-3xl mr-auto animate-pulse">
                            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0"><Bot className="w-4 h-4" /></div>
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
                    {/* Tagging Menu */}
                    {showTagMenu && filteredPatients && filteredPatients.length > 0 && (
                        <div className="absolute bottom-full left-16 mb-2 bg-white rounded-xl shadow-xl border border-indigo-100 w-64 overflow-hidden z-50 animate-in slide-in-from-bottom-2 fade-in">
                            <div className="px-3 py-2 bg-indigo-50 text-indigo-700 text-xs font-bold border-b border-indigo-100">
                                Seleziona Paziente (@)
                            </div>
                            {filteredPatients.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => selectPatientTag(p)}
                                    className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm text-gray-700 flex justify-between items-center"
                                >
                                    <span>{p.lastName} {p.firstName}</span>
                                    <span className="text-[10px] text-gray-400">{p.taxCode}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {selectedPatientName && (
                        <div className="absolute bottom-full left-16 mb-2 bg-green-50 text-green-700 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 border border-green-100 shadow-sm animate-in zoom-in fade-in">
                            <User className="w-3 h-3" />
                            Contesto: {selectedPatientName}
                            <button onClick={() => { setSelectedPatientId(null); setSelectedPatientName(null); }} className="hover:text-green-900" aria-label="Rimuovi contesto" title="Rimuovi contesto"><X className="w-3 h-3" /></button>
                        </div>
                    )}

                    <div className="flex gap-2 items-end">
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*,.pdf,.txt" onChange={handleFileUpload} aria-label="Carica file" title="Carica file" />
                        <button onClick={() => fileInputRef.current?.click()} className="p-3 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all" aria-label="Allega file" title="Allega file"><Paperclip className="w-5 h-5" /></button>

                        <div className="flex-1 bg-gray-50 border border-gray-200 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10 rounded-2xl flex items-center transition-all relative">
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        if (showTagMenu && filteredPatients && filteredPatients.length > 0) {
                                            e.preventDefault();
                                            selectPatientTag(filteredPatients[0]);
                                        } else {
                                            sendMessage();
                                        }
                                    }
                                }}
                                placeholder="Scrivi un messaggio... (Usa @ per taggare un paziente)"
                                disabled={isLoading}
                                className="flex-1 bg-transparent border-0 focus:ring-0 px-4 py-3 min-h-[50px] max-h-[150px] text-sm font-medium placeholder:text-gray-400"
                            />
                        </div>

                        <button onClick={sendMessage} disabled={isLoading || (!input.trim() && !attachment)} className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-md" aria-label="Invia messaggio" title="Invia messaggio"><Send className="w-5 h-5" /></button>
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
