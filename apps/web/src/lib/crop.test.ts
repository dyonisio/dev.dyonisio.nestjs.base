import { describe, expect, it } from 'vitest';
import { centerOffset, clampOffset, coverScale, sourceSquare, zoomAround } from './crop';

// Foto de celular deitada: 4000 × 3000, numa janela de 300 px
const photo = { width: 4000, height: 3000 };
const VIEW = 300;

describe('recorte quadrado', () => {
  it('zoom 1: o lado menor da foto cobre a janela', () => {
    expect(coverScale(photo, VIEW)).toBe(0.1); // 3000 × 0.1 = 300
  });

  it('centralizado: recorta o quadrado do meio da foto', () => {
    const scale = coverScale(photo, VIEW);
    const offset = centerOffset(photo, VIEW, scale);

    expect(offset).toEqual({ x: -50, y: 0 });
    expect(sourceSquare(offset, VIEW, scale)).toEqual({ x: 500, y: 0, size: 3000 });
  });

  it('não deixa arrastar para fora (nunca aparece fundo vazio)', () => {
    const scale = coverScale(photo, VIEW);

    expect(clampOffset({ x: 80, y: 40 }, photo, VIEW, scale)).toEqual({ x: 0, y: 0 });
    expect(clampOffset({ x: -999, y: -999 }, photo, VIEW, scale)).toEqual({ x: -100, y: 0 });
  });

  it('aproximar mantém o centro: zoom 2 no meio pega o quadrado central menor', () => {
    const base = coverScale(photo, VIEW);
    const centered = centerOffset(photo, VIEW, base);
    const offset = zoomAround(centered, photo, VIEW, base, base * 2);

    expect(sourceSquare(offset, VIEW, base * 2)).toEqual({ x: 1250, y: 750, size: 1500 });
  });

  it('afastar perto da borda não deixa a imagem descobrir a janela', () => {
    const base = coverScale(photo, VIEW);
    const zoomed = { x: -600, y: -300 }; // no zoom 2, canto inferior direito
    const back = zoomAround(zoomed, photo, VIEW, base * 2, base);

    expect(back.x).toBeGreaterThanOrEqual(VIEW - photo.width * base);
    expect(back.y).toBeGreaterThanOrEqual(VIEW - photo.height * base);
  });
});
