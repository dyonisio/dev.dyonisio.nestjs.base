/**
 * Contas do recorte quadrado (avatar). A imagem é mostrada atrás de uma janela quadrada de
 * `view` px; a pessoa arrasta (offset) e aproxima (zoom). Tudo aqui é puro, para testar.
 *
 *   escala = cobrir(view) × zoom      (zoom 1 = a imagem cobre a janela exatamente no lado menor)
 *   offset = posição do canto superior esquerdo da imagem dentro da janela (≤ 0)
 */
export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** Escala em que a imagem cobre a janela inteira (o lado menor encosta na borda). */
export function coverScale(image: Size, view: number): number {
  return Math.max(view / image.width, view / image.height);
}

/** Mantém a imagem cobrindo a janela: não deixa aparecer fundo vazio em nenhum lado. */
export function clampOffset(offset: Point, image: Size, view: number, scale: number): Point {
  const minX = view - image.width * scale;
  const minY = view - image.height * scale;
  return {
    x: Math.min(0, Math.max(minX, offset.x)),
    y: Math.min(0, Math.max(minY, offset.y)),
  };
}

/** Offset que centraliza a imagem na janela. */
export function centerOffset(image: Size, view: number, scale: number): Point {
  return { x: (view - image.width * scale) / 2, y: (view - image.height * scale) / 2 };
}

/**
 * Muda o zoom mantendo fixo o ponto da imagem que está no centro da janela
 * (aproximar não "foge" do que a pessoa estava olhando).
 */
export function zoomAround(
  offset: Point,
  image: Size,
  view: number,
  fromScale: number,
  toScale: number,
): Point {
  const center = view / 2;
  const ratio = toScale / fromScale;
  return clampOffset(
    { x: center - (center - offset.x) * ratio, y: center - (center - offset.y) * ratio },
    image,
    view,
    toScale,
  );
}

/** O quadrado da imagem ORIGINAL que está visível na janela (em pixels da original). */
export function sourceSquare(offset: Point, view: number, scale: number) {
  // (0 - n) em vez de -n: evita o "-0" quando a imagem está encostada na borda
  return { x: (0 - offset.x) / scale, y: (0 - offset.y) / scale, size: view / scale };
}
