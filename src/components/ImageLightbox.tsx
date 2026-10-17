import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { useModalKeys } from '../hooks/useModalKeys';

/**
 * Uma imagem de cartão ou resumo em tela cheia. Abre ajustada à tela; um clique na imagem
 * alterna para o tamanho real (com rolagem, para ler o texto miúdo de um esquema) e de volta.
 * Esc, o X ou um clique fora da imagem fecham.
 */
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [actualSize, setActualSize] = useState(false);

  // Esc fecha, a página por trás não rola e nenhuma tecla chega aos atalhos da tela por baixo.
  useModalKeys(onClose);

  // Num portal: o cartão tem posicionamento próprio, e a imagem precisa cobrir a tela toda.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/85"
      role="dialog"
      aria-modal="true"
      aria-label="Imagem ampliada"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
        aria-label="Fechar imagem"
        title="Fechar (Esc)"
      >
        <X size={20} />
      </button>
      <div className="flex min-h-0 flex-1 overflow-auto p-4">
        <img
          src={src}
          alt=""
          onClick={(e) => {
            e.stopPropagation();
            setActualSize((v) => !v);
          }}
          className={`m-auto rounded-md ${
            actualSize ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'
          }`}
        />
      </div>
      <p className="pb-3 text-center text-xs text-white/70">
        Clique na imagem para alternar entre ajustar à tela e tamanho real · Esc ou clique fora para fechar
      </p>
    </div>,
    document.body,
  );
}
