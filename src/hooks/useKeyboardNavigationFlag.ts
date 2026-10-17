import { useEffect, useRef, type MutableRefObject } from 'react';

/**
 * Diz se o usuário chegou ao foco atual andando com Tab (`true`) ou clicando com o mouse (`false`).
 * Quem navega por teclado espera que o Enter "clique" no botão focado; depois de um clique do mouse,
 * o Enter é dos atalhos da tela (o `:focus-visible` não distingue os dois: o navegador o liga assim
 * que qualquer tecla é apertada). Sempre ligado, também enquanto os atalhos estão desligados: um
 * clique nessa hora conta.
 */
export function useKeyboardNavigationFlag(): MutableRefObject<boolean> {
  const flag = useRef(false);
  useEffect(() => {
    const onTab = (event: KeyboardEvent) => {
      if (event.key === 'Tab') flag.current = true;
    };
    const onPointerDown = () => {
      flag.current = false;
    };
    window.addEventListener('keydown', onTab, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onTab, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);
  return flag;
}
