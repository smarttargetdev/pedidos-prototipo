import { useEffect, useState } from 'react';
import { Copy, Check, Download, FileCode2, FolderOpen } from 'lucide-react';
import type { DotnetSourceFileDto } from '../types';

export function DotnetCodeExplorer() {
  const [files, setFiles] = useState<DotnetSourceFileDto[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/dotnet/files')
      .then((r) => r.json())
      .then((data: { files: DotnetSourceFileDto[] }) => {
        if (!active) return;
        setFiles(data.files);
        const preferred =
          data.files.find((f) => f.path.includes('OrdersController.cs')) ?? data.files[0];
        if (preferred) setSelectedPath(preferred.path);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedFile = files.find((f) => f.path === selectedPath);

  const grouped = files.reduce<Record<string, DotnetSourceFileDto[]>>((acc, file) => {
    (acc[file.project] ??= []).push(file);
    return acc;
  }, {});

  const handleCopy = async () => {
    if (!selectedFile) return;
    await navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadFile = () => {
    if (!selectedFile) return;
    const blob = new Blob([selectedFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedFile.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
        Carregando projetos .NET 10 (api, worker, Core e Infrastructure)...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-4 space-y-4 max-h-[76vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Solução .NET 10</h2>
          <span className="text-xs text-slate-500 tabular-nums">{files.length} arquivos</span>
        </div>

        <div className="space-y-4">
          {Object.entries(grouped).map(([project, projectFiles]) => (
            <div key={project} className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 px-2 py-1">
                <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{project}</span>
              </div>
              <div className="space-y-0.5">
                {projectFiles.map((file) => {
                  const isActive = file.path === selectedPath;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedPath(file.path)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs rounded-lg transition-colors ${
                        isActive
                          ? 'bg-slate-900 text-white font-medium'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <FileCode2 className="w-3.5 h-3.5 shrink-0 opacity-75" />
                      <span className="truncate font-mono">{file.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
        {selectedFile ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <div className="min-w-0">
                <div className="text-xs font-mono font-medium text-slate-900 truncate">
                  dotnet/{selectedFile.path}
                </div>
                <div className="text-[11px] text-slate-500">{selectedFile.project}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadFile}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar
                </button>
              </div>
            </div>
            <div className="bg-slate-950 text-slate-100 p-4 overflow-auto max-h-[68vh]">
              <pre className="text-xs font-mono leading-relaxed tabular-nums">
                <code>{selectedFile.content}</code>
              </pre>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-xs text-slate-500">
            Selecione um arquivo à esquerda para visualizar o código .NET 10.
          </div>
        )}
      </section>
    </div>
  );
}
