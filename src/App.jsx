import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { getAuth, signInWithRedirect, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import ReactMarkdown from 'react-markdown';
import { Search, Send, Plus, Settings, MessageSquare, Trash2, Mic, X, Edit2, Volume2, Globe, ThumbsUp, ThumbsDown, Moon, Sun, Menu, Check } from 'lucide-react';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Konfigurasi Firebase dari File .env
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

export default function App() {
  const [user, setUser] = useState(null);
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [language, setLanguage] = useState('Indonesian');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const messagesEndRef = useRef(null);

  // Kamus Bahasa
  const i18n = {
    Indonesian: { newChat: "Chat Baru", chatQurox: "Chat Qurox", login: "Login dengan Google", settings: "Pengaturan" },
    English: { newChat: "New Chat", chatQurox: "Chat Qurox", login: "Login with Google", settings: "Settings" }
  };
  const t = i18n[language] || i18n['Indonesian'];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (user) loadChats(user.uid);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadChats = async (userId) => {
    try {
      const q = query(collection(db, "users", userId, "chats"), orderBy("updatedAt", "desc"));
      const querySnapshot = await getDocs(q);
      const loadedChats = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChats(loadedChats);
      if (loadedChats.length > 0) loadMessages(userId, loadedChats[0].id);
    } catch (e) {
      console.error("Error loading chats: ", e);
    }
  };

  const loadMessages = async (userId, chatId) => {
    setActiveChatId(chatId);
    try {
      const q = query(collection(db, "users", userId, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
      const querySnapshot = await getDocs(q);
      setMessages(querySnapshot.docs.map(doc => doc.data()));
    } catch (e) {
      console.error("Error loading messages:", e);
    }
  };

  const login = () => signInWithRedirect(auth, new GoogleAuthProvider());
  const logout = () => signOut(auth);

  const createNewChat = async () => {
    if (!user) return;
    const newChat = { title: "Percakapan Baru", updatedAt: serverTimestamp() };
    const docRef = await addDoc(collection(db, "users", user.uid, "chats"), newChat);
    setChats([{ id: docRef.id, ...newChat }, ...chats]);
    setActiveChatId(docRef.id);
    setMessages([]);
    setIsSidebarOpen(false);
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim() || !user || isLoading) return;

    let currentChatId = activeChatId;
    if (!currentChatId) {
      const newChat = { title: input.substring(0, 30) + '...', updatedAt: serverTimestamp() };
      const docRef = await addDoc(collection(db, "users", user.uid, "chats"), newChat);
      currentChatId = docRef.id;
      setChats([{ id: docRef.id, ...newChat }, ...chats]);
      setActiveChatId(currentChatId);
    }

    const userMsg = { role: "user", text: input, createdAt: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      await addDoc(collection(db, "users", user.uid, "chats", currentChatId, "messages"), userMsg);
      await updateDoc(doc(db, "users", user.uid, "chats", currentChatId), { updatedAt: serverTimestamp() });

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        tools: useWebSearch ? [{ googleSearch: {} }] : []
      });

      // Filter prompt
      let systemPrompt = `You are QUROX, an AI assistant. Reply in ${language}. `;
      const lastCmd = input.trim().toLowerCase();
      if (lastCmd.includes('/friend')) systemPrompt += "Act as a very close friend, use slang (woy, cuy, wkwk), be funny but helpful. ";
      if (lastCmd.includes('/comedian')) systemPrompt += "Act as a stand-up comedian. Every answer must have a joke or punchline. ";
      if (lastCmd.includes('/teacher')) systemPrompt += "Act as a professional teacher, explain step-by-step strictly. ";
      if (lastCmd.includes('/tsundere')) systemPrompt += "Act as a Tsundere character, act cold/angry but actually care. ";
      if (!useWebSearch) systemPrompt += "If asked about lyrics or recent news, admit you don't know rather than hallucinating.";

      const history = messages.map(m => ({ role: m.role === 'ai' ? 'model' : 'user', parts: [{ text: m.text }] }));
      const chat = model.startChat({ history: [{ role: 'user', parts: [{ text: systemPrompt }] }, { role: 'model', parts: [{ text: "Understood." }] }, ...history] });

      const result = await chat.sendMessage(input);
      const aiResponse = result.response.text();

      const aiMsg = { role: "ai", text: aiResponse, createdAt: new Date() };
      setMessages(prev => [...prev, aiMsg]);
      await addDoc(collection(db, "users", user.uid, "chats", currentChatId, "messages"), aiMsg);

    } catch (error) {
      console.error(error);
      const errorMsg = { role: "ai", text: "Terjadi kesalahan API. Pastikan kunci API sudah benar.", createdAt: new Date() };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedback = async (msgIndex, type) => {
    if (!user || !activeChatId) return;
    const msg = messages[msgIndex];
    await addDoc(collection(db, "feedback"), { uid: user.uid, message: msg.text, type: type, timestamp: serverTimestamp() });
    alert(type === 'up' ? 'Tanggapan positif dikirim!' : 'Ulasan dikirim ke tim support.');
  };

  const bgClass = theme === 'dark' ? 'bg-[#0f0f11] text-gray-200' : 'bg-gray-50 text-gray-900';
  const panelClass = theme === 'dark' ? 'bg-[#18181b] border-gray-800' : 'bg-white border-gray-200';
  const primaryColor = 'text-purple-500';

  if (!user) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${bgClass}`}>
        <div className={`p-8 rounded-2xl shadow-xl border ${panelClass} text-center`}>
          <h1 className="text-3xl font-bold mb-4 flex items-center justify-center gap-2">
            <span className={primaryColor}>✧</span> QUROX CHAT
          </h1>
          <button onClick={login} className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium">
            {t.login}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen ${bgClass}`}>
      {/* Sidebar */}
      <div className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:static w-72 h-full z-20 transition-transform duration-300 ${panelClass} border-r flex flex-col`}>
        <div className="p-4 flex items-center justify-between border-b border-gray-800">
          <h2 className="font-bold flex items-center gap-2"><span className={primaryColor}>✧</span> QUROX</h2>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2"><X size={20}/></button>
        </div>
        <div className="p-3">
          <button onClick={createNewChat} className={`w-full flex items-center gap-2 px-4 py-3 rounded-xl border ${theme === 'dark' ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-200 hover:bg-gray-100'} transition-colors`}>
            <Plus size={18} className={primaryColor} /> <span>{t.newChat}</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {chats.map(chat => (
            <button key={chat.id} onClick={() => loadMessages(user.uid, chat.id)} className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 ${activeChatId === chat.id ? (theme === 'dark' ? 'bg-gray-800 text-purple-400' : 'bg-purple-100 text-purple-700') : 'hover:bg-gray-500/10'}`}>
              <MessageSquare size={16} />
              <span className="truncate flex-1 text-sm">{chat.title}</span>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-gray-800 flex justify-between items-center">
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-2 rounded-lg hover:bg-gray-500/20">
            {theme === 'dark' ? <Sun size={20} className={primaryColor}/> : <Moon size={20} className={primaryColor}/>}
          </button>
          <img src={user.photoURL} alt="User" className="w-8 h-8 rounded-full border border-purple-500" />
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className={`p-4 flex items-center justify-between border-b ${panelClass}`}>
          <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden"><Menu size={24}/></button>
          <div className="flex items-center gap-3 ml-auto">
            <button onClick={() => setUseWebSearch(!useWebSearch)} className={`p-2 rounded-full transition-colors ${useWebSearch ? 'bg-purple-500/20 text-purple-500' : 'text-gray-500 hover:bg-gray-500/20'}`}>
              <Globe size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-50">
              <span className={`text-6xl ${primaryColor} mb-4`}>✧</span>
              <h2 className="text-2xl font-bold">Halo, GyzTrex!</h2>
              <p>Mulai ketik / untuk mengganti karakter QUROX.</p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-5 py-3 ${msg.role === 'user' ? 'bg-purple-600 text-white' : panelClass}`}>
                  <ReactMarkdown className="prose prose-sm dark:prose-invert max-w-none">{msg.text}</ReactMarkdown>
                  {msg.role === 'ai' && (
                    <div className="flex gap-2 mt-3 border-t border-gray-700/50 pt-2 opacity-70">
                      <button onClick={() => handleFeedback(idx, 'up')} className="hover:text-purple-500 p-1"><ThumbsUp size={14}/></button>
                      <button onClick={() => handleFeedback(idx, 'down')} className="hover:text-red-500 p-1"><ThumbsDown size={14}/></button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && <div className="animate-pulse flex items-center gap-2 p-4"><span className={primaryColor}>✧</span> Memproses...</div>}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 w-full max-w-4xl mx-auto">
          <div className="relative">
            {showSlashMenu && (
              <div className={`absolute bottom-16 left-0 w-64 rounded-xl border p-2 shadow-xl ${panelClass}`}>
                {['/friend', '/comedian', '/teacher', '/tsundere'].map(cmd => (
                  <button key={cmd} onClick={() => { setInput(cmd + ' '); setShowSlashMenu(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-purple-500/20 mb-1 font-mono text-sm">
                    {cmd}
                  </button>
                ))}
              </div>
            )}
            <div className={`flex items-end gap-2 p-2 rounded-2xl border ${theme === 'dark' ? 'bg-[#18181b] border-gray-700' : 'bg-white border-gray-300'}`}>
              <textarea
                value={input}
                onChange={(e) => { setInput(e.target.value); setShowSlashMenu(e.target.value === '/'); }}
                placeholder={t.chatQurox}
                className="flex-1 max-h-32 min-h-[44px] bg-transparent border-0 outline-none resize-none px-3 py-2"
                rows={1}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              />
              <button onClick={handleSend} disabled={!input.trim() || isLoading} className="p-3 mb-1 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-all">
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
