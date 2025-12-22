
import React, { useState, useCallback, useEffect } from 'react';
import { parseCurl, substituteParams } from './utils/curlParser';
import { parseCSV, downloadCSV } from './utils/csvHelper';
import { TestCase, TestStatus, MatchStrategy, ComparisonConfig } from './types';

const FORBIDDEN_HEADERS = [
  'user-agent', 'referer', 'origin', 'host', 'cookie', 
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
  'content-length', 'connection'
];

const STORAGE_KEY = 'horoscope_qa_v3';

const App: React.FC = () => {
  const [curlString, setCurlString] = useState<string>('');
  const [inputRows, setInputRows] = useState<Record<string, string>[]>([]);
  const [expectedRows, setExpectedRows] = useState<Record<string, string>[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expectedField, setExpectedField] = useState('description');
  const [selectedCase, setSelectedCase] = useState<TestCase | null>(null);
  const [fetchMode, setFetchMode] = useState<'bypass' | 'direct'>('bypass');
  const [manualResponse, setManualResponse] = useState('');
  const [syncFeedback, setSyncFeedback] = useState(false);

  const [compConfig, setCompConfig] = useState<ComparisonConfig>({
    jsonPath: 'prediction',
    strategy: MatchStrategy.CONTAINS
  });

  // Custom headers disabled (removed per request)


  // Persist settings and results
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.testCases) setTestCases(parsed.testCases);
        if (parsed.curlString) setCurlString(parsed.curlString);
        if (parsed.expectedField) setExpectedField(parsed.expectedField);
        if (parsed.compConfig) setCompConfig(parsed.compConfig);
      } catch (e) { console.error("Restore error", e); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ testCases, curlString, expectedField, compConfig }));
  }, [testCases, curlString, expectedField, compConfig]);

  const getValueByPath = (obj: any, path: string): string => {
    if (obj === undefined || obj === null) return '';
    if (!path || !path.trim()) return typeof obj === 'object' ? JSON.stringify(obj, null, 2) : String(obj);

    const parts = path.trim().replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '').split('.').filter(p => p !== '');
    let current = obj;
    let found = true;

    // Handle initial array wrappers if common (e.g. [{prediction: "..."}] )
    if (Array.isArray(current) && parts[0] !== '0' && isNaN(Number(parts[0]))) {
      current = current[0];
    }

    for (const part of parts) {
      if (current === null || current === undefined) { found = false; break; }
      if (typeof current === 'object' && current[part] !== undefined) {
        current = current[part];
      } else if (Array.isArray(current) && !isNaN(Number(part)) && current[Number(part)] !== undefined) {
        current = current[Number(part)];
      } else { found = false; break; }
    }

    if (found && current !== undefined && current !== null) {
      return typeof current === 'object' ? JSON.stringify(current, null, 2) : String(current).trim();
    }
    return typeof obj === 'string' ? obj : '';
  };

  const generateTestCases = useCallback((inputs: Record<string, string>[], expecteds: Record<string, string>[]) => {
    if (inputs.length === 0) return;
    const cases: TestCase[] = inputs.map((row, idx) => {
      // Logic to find the baseline: Look for user-defined field, then 'description', then first available column
      let expectedVal = '';
      const sourceRow = (expecteds.length > 0 ? expecteds[idx] : row) || {};
      
      if (sourceRow[expectedField]) {
        expectedVal = sourceRow[expectedField];
      } else if (sourceRow['description']) {
        expectedVal = sourceRow['description'];
      } else {
        // Fallback to the first column if the specified one isn't found
        expectedVal = Object.values(sourceRow)[0] || '';
      }

      return {
        id: `tc-${idx}-${Date.now()}`,
        params: row,
        expectedResult: expectedVal,
        status: TestStatus.PENDING
      };
    });
    setTestCases(cases);
  }, [expectedField]);

  // Custom header helpers removed (disabled in this version)


  const runTests = async () => {
    const configTemplate = parseCurl(curlString);
    if (!configTemplate.url || testCases.length === 0) {
      alert('Missing requirements.');
      return;
    }

    setIsRunning(true);
    setProgress(0);
    const updated = [...testCases];

    const MAX_ATTEMPTS = 3;
    const ATTEMPT_DELAY_MS = 2000; // 2 seconds between attempts

    for (let i = 0; i < updated.length; i++) {
      const tc = updated[i];
      tc.status = TestStatus.RUNNING;
      setTestCases([...updated]);

      try {
        const finalUrl = substituteParams(configTemplate.url, tc.params);
        tc.finalUrl = finalUrl;

        let rawText = '';
        let status = 0;
        let attempt = 0;
        let success = false;

        while (attempt < MAX_ATTEMPTS && !success) {
          attempt++;
          try {
            if (fetchMode === 'bypass') {
              const headersDbg: Record<string, string> = {};
              Object.entries(configTemplate.headers).forEach(([k, v]) => {
                if (!FORBIDDEN_HEADERS.includes(k.toLowerCase())) headersDbg[k] = substituteParams(v, tc.params);
              });
              tc.finalHeaders = headersDbg;

              const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(finalUrl)}`);
              const data = await res.json();
              rawText = data.contents;
              status = res.status;
            } else {
              const headers: Record<string, string> = {};
              Object.entries(configTemplate.headers).forEach(([k, v]) => {
                if (!FORBIDDEN_HEADERS.includes(k.toLowerCase())) headers[k] = substituteParams(v, tc.params);
              });

              tc.finalHeaders = { ...headers };

              console.debug('Request for', tc.id, { url: finalUrl, headers: tc.finalHeaders });

              const res = await fetch(finalUrl, { method: configTemplate.method, headers });
              rawText = await res.text();
              status = res.status;
            }

            // Consider it successful if we got a 200 and non-empty response
            if (status === 200 && rawText && rawText.trim() !== '') {
              success = true;
            } else {
              if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, ATTEMPT_DELAY_MS));
            }
          } catch (err) {
            // If request failed, wait and retry up to MAX_ATTEMPTS
            if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, ATTEMPT_DELAY_MS));
          }
        }

        tc.statusCode = status;
        tc.actualResponse = rawText;

        let targetValue = '';
        try {
          const json = JSON.parse(rawText);
          targetValue = getValueByPath(json, compConfig.jsonPath);
        } catch { targetValue = rawText; }

        tc.comparedValue = targetValue;
        tc.status = targetValue.toLowerCase().includes(tc.expectedResult.toLowerCase()) ? TestStatus.PASSED : TestStatus.FAILED;

      } catch (err: any) {
        tc.status = TestStatus.ERROR;
        tc.actualResponse = `Error: ${err.message}`;
      }

      setProgress(Math.round(((i + 1) / updated.length) * 100));
      setTestCases([...updated]);
    }

    setIsRunning(false);
  };

  const applyManualOverride = () => {
    if (!selectedCase || !manualResponse) return;
    const updated = [...testCases];
    const index = updated.findIndex(c => c.id === selectedCase.id);
    if (index === -1) return;

    const tc = updated[index];
    tc.actualResponse = manualResponse;
    tc.statusCode = 200;
    
    let targetValue = '';
    try {
      const json = JSON.parse(manualResponse);
      targetValue = getValueByPath(json, compConfig.jsonPath);
    } catch { targetValue = manualResponse; }
    
    tc.comparedValue = targetValue;
    tc.status = targetValue.toLowerCase().includes(tc.expectedResult.toLowerCase()) ? TestStatus.PASSED : TestStatus.FAILED;
    
    setTestCases(updated);
    setSelectedCase({ ...tc });
    setManualResponse('');
    setSyncFeedback(true);
    setTimeout(() => setSyncFeedback(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 p-6 flex flex-col md:flex-row justify-between items-center bg-[#1E293B] shadow-2xl gap-6 sticky top-0 z-[60]">
        <div className="flex items-center gap-4">
          <div className="bg-indigo-600 p-3 rounded-2xl shadow-indigo-500/20 shadow-xl">
            <i className="fas fa-stethoscope text-xl"></i>
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter uppercase flex items-center gap-2">
              Horoscope QA Suite
              <span className="text-[10px] bg-slate-900 border border-indigo-500/30 px-2 py-0.5 rounded text-indigo-400">PRO V3</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Accuracy & Validation Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap justify-center">
          <div className="bg-slate-900/50 p-1.5 rounded-2xl flex border border-slate-700">
            <button onClick={() => setFetchMode('direct')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${fetchMode === 'direct' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Direct</button>
            <button onClick={() => setFetchMode('bypass')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${fetchMode === 'bypass' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Proxy</button>
          </div>
          
          <div className="flex gap-2">
            <button onClick={() => { setTestCases([]); localStorage.removeItem(STORAGE_KEY); }} className="bg-slate-800 hover:bg-rose-600/20 hover:text-rose-400 border border-slate-700 p-3 rounded-2xl transition-all" title="Reset All">
              <i className="fas fa-trash-can"></i>
            </button>
            <button onClick={() => downloadCSV(testCases, 'qa_report.csv')} disabled={testCases.length === 0} className="bg-emerald-600 hover:bg-emerald-500 px-6 py-3 rounded-2xl font-black shadow-lg disabled:opacity-30 text-[10px] uppercase flex items-center gap-2">
              <i className="fas fa-file-export"></i> Report
            </button>
            <button 
              onClick={runTests} disabled={isRunning || !curlString}
              className="bg-indigo-600 hover:bg-indigo-500 px-8 py-3 rounded-2xl font-black shadow-lg disabled:opacity-30 transition-all uppercase text-[10px] flex items-center gap-3"
            >
              {isRunning ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-vial"></i>}
              {isRunning ? 'Validating...' : 'Start Automation'}
            </button>
          </div>
        </div>
      </header>

      <main className="p-8 space-y-8 max-w-[1800px] mx-auto w-full">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><i className="fas fa-code text-indigo-500"></i> 1. API Template</h3>
            <textarea value={curlString} onChange={e => setCurlString(e.target.value)} className="w-full h-64 bg-[#1E293B] border border-slate-800 p-6 rounded-[2rem] font-mono text-[11px] text-emerald-400 focus:border-indigo-500 outline-none shadow-inner" placeholder="Paste Postman cURL..." />

            <div className="mt-4 bg-[#111827] border border-slate-800 p-4 rounded-xl">
              <div className="flex items-start justify-between">
                <label className="text-[9px] font-black text-indigo-400 uppercase mb-2 block">Custom Headers</label>
                <div className="text-[10px] text-slate-500 italic">Disabled in this version</div>
              </div>
              <p className="text-[9px] text-slate-500 italic mt-3">Custom header editing and presets have been disabled as requested. The runner will only use headers parsed from the uploaded cURL.</p>
            </div> 
          </div>

          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><i className="fas fa-table-list text-indigo-500"></i> 2. Scenarios CSV</h3>
            <div className="h-64 border-4 border-dashed border-slate-800 rounded-[2rem] flex flex-col items-center justify-center p-8 bg-[#1E293B]/30 hover:bg-[#1E293B] transition-all relative group">
              <input type="file" accept=".csv" onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const rows = parseCSV(ev.target?.result as string);
                  setInputRows(rows);
                  generateTestCases(rows, expectedRows);
                };
                reader.readAsText(file);
              }} className="absolute inset-0 opacity-0 cursor-pointer" />
              <i className="fas fa-file-csv text-3xl text-slate-700 mb-4 group-hover:text-indigo-500 transition-colors"></i>
              <p className="text-[10px] font-black uppercase text-slate-500">{inputRows.length > 0 ? `${inputRows.length} ROWS LOADED` : 'UPLOAD INPUTS'}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><i className="fas fa-file-circle-check text-indigo-500"></i> 3. Baseline CSV</h3>
            <div className="h-64 border-4 border-dashed border-slate-800 rounded-[2rem] flex flex-col items-center justify-center p-8 bg-[#1E293B]/30 hover:bg-[#1E293B] transition-all relative group">
              <input type="file" accept=".csv" onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const rows = parseCSV(ev.target?.result as string);
                  setExpectedRows(rows);
                  generateTestCases(inputRows, rows);
                };
                reader.readAsText(file);
              }} className="absolute inset-0 opacity-0 cursor-pointer" />
              <i className="fas fa-bullseye text-3xl text-slate-700 mb-4 group-hover:text-emerald-500 transition-colors"></i>
              <p className="text-[10px] font-black uppercase text-slate-500">{expectedRows.length > 0 ? `${expectedRows.length} BASELINES LOADED` : 'UPLOAD EXPECTED'}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><i className="fas fa-sliders-h text-indigo-500"></i> 4. Field Mapping</h3>
            <div className="h-64 bg-[#1E293B] border border-slate-800 p-8 rounded-[2rem] space-y-4 flex flex-col justify-center shadow-xl">
              <div>
                <label className="text-[9px] font-black text-indigo-400 uppercase mb-1 block">JSON Prediction Path</label>
                <input value={compConfig.jsonPath} onChange={e => setCompConfig({...compConfig, jsonPath: e.target.value})} className="w-full bg-slate-900 border border-slate-700 p-2.5 rounded-xl text-[11px] font-bold text-emerald-400" placeholder="prediction" />
              </div>
              <div>
                <label className="text-[9px] font-black text-emerald-400 uppercase mb-1 block">CSV Description Column</label>
                <input value={expectedField} onChange={e => setExpectedField(e.target.value)} className="w-full bg-slate-900 border border-slate-700 p-2.5 rounded-xl text-[11px] font-bold" placeholder="description" />
              </div>
              <p className="text-[8px] text-slate-500 font-bold uppercase leading-tight italic">Matched data will be used for Pass/Fail status</p>
            </div>
          </div>
        </section>

        {testCases.length > 0 && (
          <div className="bg-[#1E293B] rounded-[2.5rem] shadow-2xl border border-slate-800 overflow-hidden">
             <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/30">
               <h2 className="font-black uppercase tracking-tight text-sm flex items-center gap-3">
                  <i className="fas fa-list-check text-indigo-500"></i>
                  Validation Queue
               </h2>
               <div className="text-[10px] font-black flex gap-6 text-slate-500">
                  <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> PASSED: {testCases.filter(c => c.status === TestStatus.PASSED).length}</span>
                  <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-rose-500"></div> FAILED: {testCases.filter(c => c.status === TestStatus.FAILED).length}</span>
               </div>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full text-left">
                 <thead>
                   <tr className="bg-slate-900/50">
                     <th className="p-5 px-8 text-[9px] font-black uppercase text-slate-500">#</th>
                     <th className="p-5 px-8 text-[9px] font-black uppercase text-slate-500">Scenario Data</th>
                     <th className="p-5 px-8 text-[9px] font-black uppercase text-slate-500">Expectation (CSV)</th>
                     <th className="p-5 px-8 text-[9px] font-black uppercase text-slate-500 text-center">Status</th>
                     <th className="p-5 px-8 text-[9px] font-black uppercase text-slate-500 text-center">Action</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-800">
                   {testCases.map((tc, idx) => (
                     <tr key={tc.id} className="hover:bg-slate-800/20 transition-all">
                       <td className="p-5 px-8 font-bold text-slate-600 text-[11px]">{idx + 1}</td>
                       <td className="p-5 px-8">
                         <div className="flex gap-2 flex-wrap">
                           {Object.entries(tc.params).slice(0, 2).map(([k, v]) => (
                             <span key={k} className="bg-slate-900/50 px-2.5 py-1 rounded-lg text-[9px] border border-slate-700 font-bold uppercase"><span className="text-slate-500">{k}:</span> {String(v)}</span>
                           ))}
                         </div>
                       </td>
                       <td className="p-5 px-8 max-w-xs overflow-hidden">
                          <p className="text-[10px] text-slate-400 font-bold line-clamp-2 italic leading-relaxed">
                            {tc.expectedResult || "---"}
                          </p>
                       </td>
                       <td className="p-5 px-8 text-center">
                         <span className={`px-4 py-1 rounded-full text-[9px] font-black uppercase border ${
                           tc.status === TestStatus.PASSED ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 
                           tc.status === TestStatus.FAILED ? 'bg-rose-500/10 text-rose-500 border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.1)]' : 
                           tc.status === TestStatus.RUNNING ? 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' : 'bg-slate-800 text-slate-500 border-slate-700'
                         }`}>{tc.status}</span>
                       </td>
                       <td className="p-5 px-8 text-center">
                         <button onClick={() => setSelectedCase(tc)} className="bg-slate-800 hover:bg-indigo-600 px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all shadow-lg active:scale-95">Verify</button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
          </div>
        )}
      </main>

      {selectedCase && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 md:p-12">
          <div className="bg-[#1E293B] w-full max-w-6xl h-[90vh] rounded-[3rem] shadow-2xl flex flex-col border border-slate-700 overflow-hidden">
             <div className="p-6 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-4">
                   <h3 className="text-lg font-black uppercase tracking-tight">Validation Trace</h3>
                   <span className="text-[10px] font-bold bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-full border border-indigo-500/20">CASE #{testCases.findIndex(c => c.id === selectedCase.id) + 1}</span>
                </div>
                <button onClick={() => setSelectedCase(null)} className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center hover:bg-rose-500 transition-all shadow-lg"><i className="fas fa-times"></i></button>
             </div>
             
             <div className="p-10 overflow-y-auto space-y-10 flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2"><i className="fas fa-file-invoice"></i> Baseline (From CSV: {expectedField})</h4>
                      <div className="bg-slate-900 p-6 rounded-[2rem] border border-slate-800 h-48 text-[11px] font-bold text-slate-300 whitespace-pre-wrap leading-relaxed shadow-inner overflow-auto custom-scrollbar">
                        {selectedCase.expectedResult || "No description found in CSV."}
                      </div>
                   </div>
                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2"><i className="fas fa-magnifying-glass"></i> Extracted (From API: {compConfig.jsonPath})</h4>
                      <div className={`bg-slate-900 p-6 rounded-[2rem] border h-48 text-[11px] font-bold whitespace-pre-wrap leading-relaxed shadow-inner overflow-auto custom-scrollbar ${selectedCase.status === TestStatus.PASSED ? 'border-emerald-500/40 text-emerald-400' : 'border-rose-500/40 text-rose-400'}`}>
                        {selectedCase.comparedValue || <span className="italic opacity-50">Empty response. Use Postman Sync below.</span>}
                      </div>
                   </div>
                </div>

                <div className="space-y-4">
                   <div className="flex justify-between items-center">
                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Full Server Response</h4>
                      <span className="text-[9px] font-bold bg-slate-900 px-3 py-1 rounded text-slate-500 border border-slate-800 uppercase tracking-widest">Status: {selectedCase.statusCode || 'N/A'}</span>
                   </div>
                   <div className="bg-[#0F172A] p-6 rounded-[2rem] font-mono text-[10px] h-48 overflow-auto border border-slate-800 text-emerald-500/80 whitespace-pre-wrap shadow-inner custom-scrollbar">
                      {selectedCase.actualResponse || "No data captured yet."}
                   </div>

                   <div className="mt-3">
                     <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Request URL</h5>
                     <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 text-[11px] font-mono break-words">{selectedCase.finalUrl || 'N/A'}</div>

                     <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-4 mb-2">Request Headers</h5>
                     <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 text-[11px] whitespace-pre-wrap font-mono">
                       {selectedCase.finalHeaders ? (
                         Object.entries(selectedCase.finalHeaders).map(([k, v]) => (
                           <div key={k}><span className="text-slate-500">{k}:</span> {v}</div>
                         ))
                       ) : <div className="italic text-slate-500">No headers recorded for this case.</div>}
                     </div>
                   </div>
                </div>

                <div className="bg-indigo-500/5 p-8 rounded-[3rem] border border-indigo-500/10 space-y-6">
                    <div className="flex justify-between items-center">
                      <h5 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2"><i className="fas fa-sync-alt"></i> Manual Postman Sync</h5>
                      {syncFeedback && <span className="text-[10px] font-black text-emerald-500 uppercase animate-bounce"><i className="fas fa-check mr-1"></i> Saved & Validated!</span>}
                    </div>
                    <div className="flex flex-col md:flex-row gap-4">
                      <textarea 
                        value={manualResponse} 
                        onChange={e => setManualResponse(e.target.value)} 
                        placeholder="Paste the JSON response from Postman for this specific scenario..." 
                        className="flex-1 bg-slate-900 border border-slate-800 p-5 rounded-[1.5rem] text-[10px] font-mono h-24 focus:border-indigo-500 outline-none shadow-lg transition-all" 
                      />
                      <button 
                        onClick={applyManualOverride} 
                        className="bg-indigo-600 hover:bg-indigo-500 px-10 py-5 rounded-[1.5rem] font-black text-[10px] uppercase shadow-[0_10px_30px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-3 active:scale-95"
                      >
                        <i className="fas fa-save"></i> Sync Result
                      </button>
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0F172A; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      `}</style>
    </div>
  );
};

export default App;
