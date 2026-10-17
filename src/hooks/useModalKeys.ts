import { useEffect } from 'react';

/**
 * Para uma janela por cima da tela (imagem ampliada, seletor de simulado): Esc fecha, a página por
 * trás não rola, e nenhuma tecla chega aos atalhos da tela por baixo (Enter mostraria a resposta, 1 a
 * 4 avaliariam o cartão sem o usuário ver). Em captura e parando a propagação; o que a tecla faz por
 * padrão continua valendo (digitar num campo, Enter enviando um formulário, ativar um botão).
 */
export function useModalKeys(onClose: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown, true);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);
}
