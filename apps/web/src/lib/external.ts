/** Sai do site para uma página de fora (ex.: o checkout da plataforma de pagamento). */
export function goToExternal(url: string): void {
  window.location.assign(url);
}
