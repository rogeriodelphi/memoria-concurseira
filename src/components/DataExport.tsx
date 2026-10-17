import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

import { useToast } from '../contexts/ToastContext';
import { ApiError, exportAccountData } from '../services/api';

/** 12582912 → "12,0 MB"; abaixo de 1 MB, em KB. */
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/** "Seus dados": baixa tudo o que é da conta num arquivo só, para guardar fora do PC. */
export function DataExport() {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ filename: string; bytes: number } | null>(null);

  async function download() {
    setBusy(true);
    try {
      const result = await exportAccountData();
      setLast(result);
      showToast(`Arquivo gerado: ${result.filename} (${formatSize(result.bytes)}).`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível exportar os seus dados.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-6 p-6">
      <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Seus dados</h2>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        Baixa um arquivo com tudo o que é da sua conta: coleções, cartões, histórico de estudo, resumos, bullet points, mapas
        mentais, concursos, simulados e Pomodoro. A senha não vai. Guarde o arquivo fora deste computador (na nuvem ou num
        pen drive) como cópia extra.
      </p>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        O app já faz backups automáticos do banco a cada 6 horas, mas eles ficam neste PC. Este arquivo é a sua cópia
        portátil. Ainda não existe importação pelo app: para restaurar o banco inteiro, use os backups automáticos (veja o
        README).
      </p>
      <button type="button" onClick={() => void download()} disabled={busy} className="btn-secondary">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {busy ? 'Gerando...' : 'Exportar meus dados'}
      </button>
      {last && (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400" role="status">
          Último arquivo: <span className="font-medium">{last.filename}</span> ({formatSize(last.bytes)}). Procure na pasta de
          downloads do navegador.
        </p>
      )}
    </div>
  );
}
