import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import ReactMarkdown from 'react-markdown';
import { Send, Plus, MessageSquare, X, Globe, Menu, Sun, Moon, LogOut, ThumbsUp, ThumbsDown } from 'lucide-react';
import { GoogleGenerativeAI } from "@google/generative-ai";

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

  const i18n = {
    Indonesian: { newChat: "Chat Baru", chatQurox: "Ketik pesan ke QUROX...", login: "Login Akses VIP" },
    English: { newChat: "New Chat", chatQurox: "Message QUROX...", login: "Login VIP Access" }
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
      const qs = await getDocs(q);
      const loaded = qs.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChats(loaded);
      if (loaded.length > 0) loadMessages(userId, loaded[0].id);
    } catch (e) {
      console.error("Gagal memuat chat:", e);
    }
  };

  const loadMessages = async (userId, chatId) => {
    setActiveChatId(chatId);
    try {
      const q = query(collection(db, "users", userId, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
      const qs = await getDocs(q);
      setMessages(qs.docs.map(doc => doc.data()));
    } catch (e) {}
  };

  const login = () => signInWithPopup(auth, new GoogleAuthProvider());
  const logout = () => { signOut(auth); setChats([]); setMessages([]); };

  const createNewChat = async () => {
    if (!user) return;
    try {
      const newChat = { title: "Sesi Baru", updatedAt: serverTimestamp() };
      const docRef = await addDoc(collection(db, "users", user.uid, "chats"), newChat);
      setChats([{ id: docRef.id, ...newChat }, ...chats]);
      setActiveChatId(docRef.id);
      setMessages([]);
      setIsSidebarOpen(false);
    } catch (err) {
      alert("Gagal membuat sesi! Pastikan Database Firestore sudah diaktifkan.");
    }
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim() || !user || isLoading) return;

    const userText = input;
    setInput('');
    setIsLoading(true);

    const userMsg = { role: "user", text: userText, createdAt: new Date() };
    setMessages(prev => [...prev, userMsg]);

    try {
      let currentChatId = activeChatId;
      if (!currentChatId) {
        const newChat = { title: userText.substring(0, 30) + '...', updatedAt: serverTimestamp() };
        const docRef = await addDoc(collection(db, "users", user.uid, "chats"), newChat);
        currentChatId = docRef.id;
        setChats([{ id: docRef.id, ...newChat }, ...chats]);
        setActiveChatId(currentChatId);
      }

      await addDoc(collection(db, "users", user.uid, "chats", currentChatId, "messages"), userMsg);
      await updateDoc(doc(db, "users", user.uid, "chats", currentChatId), { updatedAt: serverTimestamp() });

      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      let sys = `You are QUROX. Reply in ${language}. `;
      const cmd = userText.trim().toLowerCase();
      if (cmd.includes('/friend')) sys += "Act as a very close friend (cuy, wkwk). ";
      if (cmd.includes('/comedian')) sys += "Act as a comedian. ";
      if (cmd.includes('/teacher')) sys += "Act as a step-by-step teacher. ";
      if (cmd.includes('/tsundere')) sys += "Act as a cold but caring tsundere. ";

      const history = messages.map(m => ({ role: m.role === 'ai' ? 'model' : 'user', parts: [{ text: m.text }] }));
      const chat = model.startChat({ history: [{ role: 'user', parts: [{ text: sys }] }, { role: 'model', parts: [{ text: "OK." }] }, ...history] });

      const result = await chat.sendMessage(userText);
      const aiMsg = { role: "ai", text: result.response.text(), createdAt: new Date() };
      
      setMessages(prev => [...prev, aiMsg]);
      await addDoc(collection(db, "users", user.uid, "chats", currentChatId, "messages"), aiMsg);
    } catch (error) {
      console.error(error);
      alert("SISTEM DIBLOKIR: Anda belum mengaktifkan Firestore Database di Firebase, atau API Key salah!");
      setMessages(prev => [...prev, { role: "ai", text: "Terjadi kesalahan Database.", createdAt: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  };

  const bgClass = theme === 'dark' ? 'bg-[#0f0f11] text-gray-200' : 'bg-gray-50 text-gray-900';
  const panelClass = theme === 'dark' ? 'bg-[#18181b] border-gray-800' : 'bg-white border-gray-200';
  const primaryColor = 'text-purple-500';

  if (!user) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${bgClass}`}>
        <div className={`p-8 rounded-3xl shadow-xl border ${panelClass} text-center`}>
          <h1 className="text-3xl font-bold mb-6 flex items-center gap-3"><span className={primaryColor}>✧</span> QUROX</h1>
          <button onClick={login} className="px-8 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-500 font-medium">
            {t.login}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen ${bgClass} font-sans`}>
      <div className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:static w-72 h-full z-20 transition-transform duration-300 ${panelClass} border-r flex flex-col shadow-2xl`}>
        <div className="p-5 flex items-center justify-between border-b border-gray-800/50">
          <h2 className="font-bold flex items-center gap-2"><span className={primaryColor}>✧</span> QUROX</h2>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-gray-400 hover:text-white"><X size={20}/></button>
        </div>
        <div className="p-4">
          <button onClick={createNewChat} className={`w-full flex items-center gap-2 px-4 py-3 rounded-xl border ${theme === 'dark' ? 'border-gray-800 hover:bg-gray-800/50' : 'border-gray-200 hover:bg-gray-100'} transition-all text-sm font-medium`}>
            <Plus size={18} className={primaryColor} /> {t.newChat}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {chats.map(chat => (
            <button key={chat.id} onClick={() => loadMessages(user.uid, chat.id)} className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all ${activeChatId === chat.id ? (theme === 'dark' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-purple-100 text-purple-700') : (theme === 'dark' ? 'text-gray-400 hover:bg-gray-800/50' : 'text-gray-600 hover:bg-gray-100')}`}>
              <MessageSquare size={16} />
              <span className="truncate flex-1 text-sm font-medium">{chat.title}</span>
            </button>
          ))}
        </div>
        <div className="p-5 border-t border-gray-800/50 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-2 rounded-xl hover:bg-gray-500/20 transition-all">
              {theme === 'dark' ? <Sun size={20} className={primaryColor}/> : <Moon size={20} className={primaryColor}/>}
            </button>
            <button onClick={logout} className="p-2 rounded-xl hover:bg-red-500/20 text-red-500 transition-all" title="Logout">
              <LogOut size={20} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <img src={user.photoURL} alt="User" className="w-10 h-10 rounded-full border border-purple-500/50" />
            <div className="flex flex-col">
              <span className="text-sm font-bold truncate max-w-[140px]">{user.displayName}</span>
              <span className="text-xs text-purple-500 tracking-wide">Online</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className={`p-4 flex items-center justify-between border-b ${panelClass} sticky top-0 z-10 bg-opacity-80 backdrop-blur-md`}>
          <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2"><Menu size={24}/></button>
          <div className="flex items-center gap-3 ml-auto">
            <button onClick={() => setLanguage(language === 'Indonesian' ? 'English' : 'Indonesian')} className="px-3 py-1 text-xs font-bold rounded-full border border-purple-500/50 text-purple-500 hover:bg-purple-500/10">
              {language.substring(0, 2).toUpperCase()}
            </button>
            <button onClick={() => setUseWebSearch(!useWebSearch)} className={`p-2 rounded-xl transition-all ${useWebSearch ? 'bg-purple-500/20 text-purple-500' : 'text-gray-500 hover:bg-gray-500/20'}`}>
              <Globe size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-80">
              <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 shadow-xl border ${theme === 'dark' ? 'bg-[#121216] border-gray-800' : 'bg-white border-gray-200'}`}>
                <span className="text-4xl text-purple-500">✧</span>
              </div>
              <h2 className="text-2xl font-bold tracking-wide">Halo, {user.displayName.split(' ')[0]}!</h2>
              <p className="text-gray-500 mt-2 text-sm">Ketik / untuk memuat persona AI.</p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] md:max-w-[75%] rounded-3xl px-6 py-4 shadow-md ${msg.role === 'user' ? 'bg-purple-600/90 text-white rounded-br-sm' : `${panelClass} rounded-bl-sm`}`}>
                  <ReactMarkdown className="prose prose-sm dark:prose-invert max-w-none">{msg.text}</ReactMarkdown>
                  {msg.role === 'ai' && (
                    <div className="flex gap-2 mt-3 border-t border-gray-500/30 pt-2 opacity-70">
                      <button className="hover:text-purple-500 p-1 transition-colors"><ThumbsUp size={14}/></button>
                      <button className="hover:text-red-500 p-1 transition-colors"><ThumbsDown size={14}/></button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className={`${panelClass} rounded-3xl rounded-bl-sm px-6 py-5 flex gap-2`}>
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce delay-100"></div>
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce delay-200"></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className={`p-4 border-t ${theme === 'dark' ? 'bg-[#0a0a0c]/80 border-gray-900/50' : 'bg-gray-50/80 border-gray-200'} backdrop-blur-lg`}>
          <div className="max-w-4xl mx-auto relative">
            {showSlashMenu && (
              <div className={`absolute bottom-full mb-4 left-0 w-64 rounded-2xl border p-2 shadow-2xl ${panelClass}`}>
                {['/friend', '/comedian', '/teacher', '/tsundere'].map(cmd => (
                  <button key={cmd} onClick={() => { setInput(cmd + ' '); setShowSlashMenu(false); }} className={`w-full text-left px-4 py-3 rounded-xl transition-colors font-mono text-sm ${theme === 'dark' ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-700'} hover:text-purple-500`}>
                    {cmd}
                  </button>
                ))}
              </div>
            )}
            <div className={`flex items-end gap-2 p-2 rounded-3xl border shadow-inner transition-colors ${theme === 'dark' ? 'bg-[#121216] border-gray-800 focus-within:border-purple-500/50' : 'bg-white border-gray-300 focus-within:border-purple-500'}`}>
              <textarea
                value={input}
                onChange={(e) => { setInput(e.target.value); setShowSlashMenu(e.target.value === '/'); }}
                placeholder={t.chatQurox}
                className="flex-1 max-h-32 min-h-[44px] bg-transparent border-0 outline-none resize-none px-4 py-2"
                rows={1}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              />
              <button onClick={handleSend} disabled={!input.trim() || isLoading} className="p-3 bg-purple-600/90 text-white rounded-2xl hover:bg-purple-500 disabled:opacity-50 transition-all">
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
