
import React, { useState, useRef } from 'react';
import { SubtitleEntry, ProcessingStatus, FileTask } from './types';
import { parseSRT, exportToSRT } from './utils/srtParser';
import { translateSubtitleBatch } from './services/geminiService';

const App: React.FC = () => {
  const [tasks, setTasks] = useState<FileTask[]>([]);
  const [isGlobalProcessing, setIsGlobalProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newTasks: Promise<FileTask>[] = Array.from(files).map((file: File) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          try {
            const parsed = parseSRT(content);
            if (parsed.length === 0) throw new Error("File không có dữ liệu phụ đề");
            resolve({
              id: Math.random().toString(36).substring(7),
              fileName: file.name,
              originalSubs: parsed,
              processedSubs: [],
              prompt: '',
              status: ProcessingStatus.IDLE,
              progress: 0
            });
          } catch (err: any) {
            resolve({
              id: Math.random().toString(36).substring(7),
              fileName: file.name,
              originalSubs: [],
              processedSubs: [],
              prompt: '',
              status: ProcessingStatus.ERROR,
              progress: 0,
              error: err.message || 'Định dạng file không hợp lệ'
            });
          }
        };
        reader.readAsText(file);
      });
    });

    Promise.all(newTasks).then((resolvedTasks) => {
      setTasks((prev) => [...prev, ...resolvedTasks]);
    });
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateTask = (id: string, updates: Partial<FileTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const processSingleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.originalSubs.length === 0) return;

    updateTask(task.id, { status: ProcessingStatus.PROCESSING, progress: 5, error: undefined });

    try {
      const BATCH_SIZE = 50; 
      const CONCURRENCY = 2; // Giảm xuống 2 để an toàn hơn với API free
      const results: SubtitleEntry[] = [...task.originalSubs];
      const totalEntries = task.originalSubs.length;
      let completedEntries = 0;

      const batches = [];
      for (let i = 0; i < totalEntries; i += BATCH_SIZE) {
        batches.push(task.originalSubs.slice(i, i + BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i += CONCURRENCY) {
        const currentBatches = batches.slice(i, i + CONCURRENCY);
        
        const translationPromises = currentBatches.map(async (batch, idx) => {
          // Thêm độ trễ nhỏ giữa các batch song song để tránh spike rate limit
          if (idx > 0) await new Promise(r => setTimeout(r, 500));
          
          const translatedBatch = await translateSubtitleBatch(batch, task.prompt);
          
          translatedBatch.forEach((tSub) => {
            const index = results.findIndex(r => r.id === tSub.id);
            if (index !== -1) {
              results[index] = { ...results[index], text: tSub.translatedText };
            }
          });
          
          completedEntries += batch.length;
          const currentProgress = 5 + Math.floor((completedEntries / totalEntries) * 94);
          updateTask(task.id, { progress: currentProgress });
        });

        await Promise.all(translationPromises);
        // Nghỉ 1 giây sau mỗi cụm concurrency
        await new Promise(r => setTimeout(r, 1000));
      }

      updateTask(task.id, { 
        processedSubs: results, 
        status: ProcessingStatus.COMPLETED, 
        progress: 100 
      });
    } catch (err: any) {
      updateTask(task.id, { 
        status: ProcessingStatus.ERROR, 
        error: err.message || "Lỗi dịch thuật" 
      });
      throw err; // Re-throw để vòng lặp queue biết có lỗi
    }
  };

  const processQueue = async () => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);

    const pendingTasks = tasks.filter(t => t.status !== ProcessingStatus.COMPLETED);
    
    for (const task of pendingTasks) {
      try {
        await processSingleTask(task.id);
      } catch (err) {
        // Nếu file này lỗi, vẫn tiếp tục sang file sau
        console.error(`Task ${task.fileName} failed, skipping...`);
      }
    }

    setIsGlobalProcessing(false);
  };

  const downloadTask = (task: FileTask) => {
    const content = exportToSRT(task.processedSubs);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translated_${task.fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter(t => t.id !== id));
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4 font-sans">
      <div className="max-w-6xl w-full space-y-6">
        
        {/* Header & Upload */}
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-3xl font-black text-indigo-700 tracking-tight flex items-center gap-3">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" fillOpacity="0.2"/>
                <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Gemini SRT Batch
            </h1>
            <p className="text-slate-500 text-sm font-medium mt-1">Dịch phụ đề đa luồng &bull; Ổn định &bull; Chất lượng cao</p>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              Thêm file
            </button>
            <button
              onClick={processQueue}
              disabled={isGlobalProcessing || !tasks.some(t => t.status !== ProcessingStatus.COMPLETED)}
              className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2"
            >
              {isGlobalProcessing ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Đang xử lý...
                </>
              ) : 'Bắt đầu dịch'}
            </button>
            <input 
              ref={fileInputRef} 
              type="file" 
              multiple 
              accept=".srt,.txt" 
              className="hidden" 
              onChange={handleFileUpload} 
            />
          </div>
        </div>

        {/* Task List */}
        <div className="space-y-4">
          {tasks.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-16 text-center">
              <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              </div>
              <p className="text-slate-500 font-medium">Kéo thả hoặc nhấn nút để tải file lên</p>
              <p className="text-slate-400 text-sm mt-1">Hỗ trợ file .srt, .txt</p>
            </div>
          ) : (
            tasks.map((task) => (
              <div key={task.id} className={`bg-white p-5 rounded-2xl shadow-sm border ${task.status === ProcessingStatus.ERROR ? 'border-red-200' : 'border-slate-200'} flex flex-col gap-4 transition-all`}>
                
                {/* File Info & Status */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`p-2.5 rounded-xl shrink-0 ${
                      task.status === ProcessingStatus.COMPLETED ? 'bg-green-100 text-green-600' : 
                      task.status === ProcessingStatus.ERROR ? 'bg-red-100 text-red-600' :
                      'bg-slate-100 text-slate-500'
                    }`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-800 truncate" title={task.fileName}>{task.fileName}</h3>
                      <p className="text-xs text-slate-400 font-mono">{task.originalSubs.length} lines</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 w-full md:w-auto shrink-0">
                    {task.status === ProcessingStatus.PROCESSING && (
                      <div className="flex-1 md:w-40 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div className="bg-indigo-600 h-full transition-all duration-500 ease-out" style={{ width: `${task.progress}%` }} />
                      </div>
                    )}
                    
                    <span className={`text-[10px] uppercase tracking-wider font-black px-2.5 py-1 rounded-lg ${
                      task.status === ProcessingStatus.COMPLETED ? 'bg-green-50 text-green-700' :
                      task.status === ProcessingStatus.PROCESSING ? 'bg-indigo-50 text-indigo-700' :
                      task.status === ProcessingStatus.ERROR ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {task.status === ProcessingStatus.IDLE ? 'Ready' : 
                       task.status === ProcessingStatus.PROCESSING ? `${task.progress}%` : 
                       task.status === ProcessingStatus.COMPLETED ? 'Done' : 'Error'}
                    </span>

                    <div className="flex gap-1.5">
                      {task.status === ProcessingStatus.ERROR && (
                        <button 
                          onClick={() => processSingleTask(task.id)} 
                          className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Thử lại"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        </button>
                      )}
                      {task.status === ProcessingStatus.COMPLETED && (
                        <button onClick={() => downloadTask(task)} className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Tải về">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </button>
                      )}
                      <button 
                        onClick={() => removeTask(task.id)}
                        disabled={task.status === ProcessingStatus.PROCESSING}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 transition-colors"
                        title="Gỡ bỏ"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Prompt Input */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </span>
                    <input
                      type="text"
                      placeholder="Gợi ý phong cách: 'Dịch ngắn gọn', 'Dịch kiếm hiệp', 'Dịch hài hước'..."
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                      value={task.prompt}
                      disabled={task.status === ProcessingStatus.PROCESSING || task.status === ProcessingStatus.COMPLETED}
                      onChange={(e) => updateTask(task.id, { prompt: e.target.value })}
                    />
                  </div>
                </div>

                {task.error && (
                  <div className="flex items-start gap-2 text-red-600 bg-red-50 p-3 rounded-xl">
                    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p className="text-xs font-semibold leading-relaxed">{task.error}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      
      <footer className="mt-16 text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] text-center space-y-3">
        <div className="flex justify-center items-center gap-6">
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span> Gemini 3 Flash</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span> Batch Queue</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> Safe Rate</span>
        </div>
        <div className="opacity-60 italic">Designed for professional subtitle workflows</div>
      </footer>
    </div>
  );
};

export default App;
