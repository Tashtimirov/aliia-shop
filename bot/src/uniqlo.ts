/** Разбор ссылок на товары Uniqlo, например
 *  https://www.uniqlo.com/th/en/products/E465185-000/00?colorDisplayCode=09&sizeDisplayCode=003 */
export interface UniqloLink {
  url: string;
  sourceId: string;         // E465185-000
  colorCode: string | null; // 09
  isThailand: boolean;
}

const URL_RE = /https?:\/\/[^\s]*uniqlo\.com[^\s]*/i;
const ID_RE = /\/products\/([A-Z]?\d{6}-\d{3})/i;

export function findUniqloLink(text: string): UniqloLink | null {
  const m = text.match(URL_RE);
  if (!m) return null;
  let url: URL;
  try { url = new URL(m[0]); } catch { return null; }
  const id = url.pathname.match(ID_RE);
  if (!id) return null;
  return {
    url: url.toString(),
    sourceId: id[1].toUpperCase(),
    colorCode: url.searchParams.get('colorDisplayCode'),
    isThailand: url.pathname.startsWith('/th/'),
  };
}
