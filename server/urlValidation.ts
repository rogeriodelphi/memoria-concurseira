export function isYoutubeUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
    return (host === 'youtube.com' || host === 'youtu.be') && url.protocol.startsWith('http');
  } catch {
    return false;
  }
}
