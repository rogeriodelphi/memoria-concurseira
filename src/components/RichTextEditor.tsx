import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Highlighter,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Palette,
  Subscript,
  Superscript,
  Underline,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { CARD_TEXT_STYLE, type CardTextRole } from '../utils/cardTextStyle';
import { alignImage, getSelectedImage, imageAlignForCommand, selectImage } from '../utils/editorImage';
import { cleanPastedHtml } from '../utils/pasteHtml';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Mostra o campo com o mesmo padrão visual que ele terá no cartão. */
  role?: CardTextRole;
}

const SIMPLE_COMMANDS: { command: string; icon: typeof Bold; label: string }[] = [
  { command: 'bold', icon: Bold, label: 'Negrito' },
  { command: 'italic', icon: Italic, label: 'Itálico' },
  { command: 'underline', icon: Underline, label: 'Sublinhado' },
  { command: 'superscript', icon: Superscript, label: 'Sobrescrito' },
  { command: 'subscript', icon: Subscript, label: 'Subscrito' },
];

const ALIGN_COMMANDS: { command: string; icon: typeof Bold; label: string }[] = [
  { command: 'justifyLeft', icon: AlignLeft, label: 'Alinhar à esquerda' },
  { command: 'justifyCenter', icon: AlignCenter, label: 'Centralizar' },
  { command: 'justifyRight', icon: AlignRight, label: 'Alinhar à direita' },
  { command: 'justifyFull', icon: AlignJustify, label: 'Justificar' },
];

const LIST_COMMANDS: { command: string; icon: typeof Bold; label: string }[] = [
  { command: 'insertUnorderedList', icon: List, label: 'Lista com marcadores' },
  { command: 'insertOrderedList', icon: ListOrdered, label: 'Lista numerada' },
];

const TEXT_COLORS = ['#111827', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#db2777'];
const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fed7aa', '#fecaca', '#e9d5ff'];

// Imagens maiores que isso (em dimensão ou em bytes) são reamostradas antes
// de virar base64 embutido no HTML — sem isso, uma foto de celular de vários
// MB infla o banco (SQLite guarda a coluna inteira) e cada resposta da API
// que inclui esse flashcard. Imagem pequena (ícone, print recortado) passa
// direto, preservando a qualidade original (inclusive PNG com transparência).
const MAX_IMAGE_DIMENSION = 1000;
const MAX_IMAGE_BYTES_BEFORE_COMPRESS = 500 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function fileToOptimizedDataUrl(file: File): Promise<string> {
  const original = await readFileAsDataUrl(file);
  const img = await loadImage(original);
  const needsResize = img.naturalWidth > MAX_IMAGE_DIMENSION;
  const needsCompress = file.size > MAX_IMAGE_BYTES_BEFORE_COMPRESS;
  if (!needsResize && !needsCompress) return original;

  const scale = needsResize ? MAX_IMAGE_DIMENSION / img.naturalWidth : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Bold;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
    >
      <Icon size={14} />
    </button>
  );
}

function ColorDropdown({
  icon: Icon,
  label,
  colors,
  onPick,
}: {
  icon: typeof Bold;
  label: string;
  colors: string[];
  onPick: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
      >
        <Icon size={14} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 grid grid-cols-4 gap-1 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(color);
                setOpen(false);
              }}
              className="h-5 w-5 rounded border border-black/10 dark:border-white/10"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Editor de texto rico simples via contentEditable + document.execCommand.
 * execCommand é tecnicamente "legado", mas continua funcionando em todo
 * navegador baseado em Chromium/Firefox/Safari, e pra um conjunto pequeno e
 * fixo de comandos é muito mais simples e leve do que trazer uma biblioteca
 * de editor completa.
 */
export function RichTextEditor({ value, onChange, placeholder, role }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Só reescreve o innerHTML quando o valor vem de fora (ex.: trocou de
  // flashcard) — nunca durante a digitação normal, senão o cursor pula pro
  // início a cada tecla.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
  }, [value]);

  function exec(command: string, arg?: string) {
    ref.current?.focus();

    // Com uma imagem selecionada, o alinhamento vai pras margens dela — o
    // comando nativo grava `text-align` na <img>, onde não faz efeito algum.
    const align = imageAlignForCommand(command);
    const image = align && ref.current ? getSelectedImage(ref.current) : null;
    if (align && image && ref.current) {
      alignImage(image, align);
      selectImage(image);
      onChange(ref.current.innerHTML);
      return;
    }

    // Sem isso, o Chrome produz <font color="..."> (tag legada, fora da
    // allow-list do sanitizador) em vez de `style="color:..."` — com
    // styleWithCSS ligado, os comandos de cor saem como CSS de verdade.
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  }

  async function insertImageFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    let dataUrl: string;
    try {
      dataUrl = await fileToOptimizedDataUrl(file);
    } catch {
      return;
    }
    ref.current?.focus();
    document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="">`);
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) insertImageFile(file);
  }

  // Clicar numa imagem não move a seleção do editor (o cursor fica no texto
  // de antes), então os botões de formatação nunca chegariam nela. Selecionar
  // a imagem no clique é o que permite alinhá-la. Fica no `click` e não no
  // `mousedown` pra não atrapalhar arrastar a imagem pra outro lugar.
  function handleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (e.target instanceof HTMLImageElement) {
      ref.current?.focus();
      selectImage(e.target);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const imageFile = Array.from(e.clipboardData.items)
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile();
    e.preventDefault();
    if (imageFile) {
      insertImageFile(imageFile);
      return;
    }
    // Texto copiado de um site, do Word ou de um chat de IA vem também como HTML: aproveita negrito, itálico,
    // listas e parágrafos (cor, link e imagem de fora ficam de fora). Ctrl+Shift+V cola só o texto, como sempre.
    const html = cleanPastedHtml(e.clipboardData.getData('text/html'));
    if (html) {
      document.execCommand('insertHTML', false, html);
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-700 dark:bg-neutral-800/60">
        {SIMPLE_COMMANDS.map(({ command, icon, label }) => (
          <ToolbarButton key={command} icon={icon} label={label} onClick={() => exec(command)} />
        ))}

        <div className="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />

        <ColorDropdown icon={Palette} label="Cor do texto" colors={TEXT_COLORS} onPick={(c) => exec('foreColor', c)} />
        <ColorDropdown
          icon={Highlighter}
          label="Realce"
          colors={HIGHLIGHT_COLORS}
          onPick={(c) => exec('hiliteColor', c)}
        />
        <ToolbarButton icon={Eraser} label="Limpar formatação" onClick={() => exec('removeFormat')} />

        <div className="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />

        {ALIGN_COMMANDS.map(({ command, icon, label }) => (
          <ToolbarButton key={command} icon={icon} label={label} onClick={() => exec(command)} />
        ))}

        <div className="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />

        {LIST_COMMANDS.map(({ command, icon, label }) => (
          <ToolbarButton key={command} icon={icon} label={label} onClick={() => exec(command)} />
        ))}

        <div className="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />

        <ToolbarButton icon={ImageIcon} label="Inserir imagem" onClick={() => fileInputRef.current?.click()} />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileInputChange}
        />
      </div>
      <div
        ref={ref}
        contentEditable
        onInput={() => ref.current && onChange(ref.current.innerHTML)}
        onPaste={handlePaste}
        onClick={handleClick}
        data-placeholder={placeholder}
        className={`min-h-[4.5rem] px-3.5 py-2.5 text-sm text-neutral-900 focus:outline-none ${role ? CARD_TEXT_STYLE[role] : ''} dark:text-neutral-100 [&_div]:min-h-[1em] [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_img]:my-1 [&_img]:h-auto [&_img]:max-w-full [&_img]:cursor-pointer [&_img]:rounded-md empty:before:text-neutral-400 empty:before:content-[attr(data-placeholder)]`}
      />
    </div>
  );
}
