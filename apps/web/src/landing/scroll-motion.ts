/**
 * Movimento ligado à rolagem da página inicial (GSAP + ScrollTrigger).
 *
 * O GSAP é baixado só aqui (import dinâmico): o painel não carrega nada disso. Com
 * "reduzir movimento" ligado no sistema, nada roda e a página fica como está (o deploy
 * continua no controle deslizante).
 *
 *  - Primeira tela: a janela de login dentro do nome se abre e as palavras se afastam.
 *  - Deploy: a seção fica presa enquanto a rolagem passa pelas quatro etapas (desktop).
 *  - Números: contam até o valor quando aparecem.
 */
import { useEffect, useRef, type RefObject } from 'react';

/** Leva a rolagem até uma etapa do deploy. Devolve false quando a seção não está presa. */
export type GoToStage = (index: number) => boolean;

interface Options {
  root: RefObject<HTMLElement | null>;
  stages: number;
  onStage: (index: number) => void;
}

export interface ScrollMotion {
  goToStage: RefObject<GoToStage | null>;
  /** Rola com suavidade até a seção (os links do menu). */
  scrollToId: (id: string) => void;
}

export function useScrollMotion({ root, stages, onStage }: Options): ScrollMotion {
  const goTo = useRef<GoToStage | null>(null);
  const scrollTo = useRef<((target: HTMLElement) => void) | null>(null);
  const onStageRef = useRef(onStage);
  onStageRef.current = onStage;

  useEffect(() => {
    const el = root.current;
    // Sem matchMedia (navegador muito antigo, jsdom nos testes) o GSAP não roda: a página fica parada
    if (!el || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let revert: (() => void) | undefined;
    let cancelled = false;

    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')])
      .then(([{ gsap }, { ScrollTrigger }]) => {
        if (cancelled) return;
        gsap.registerPlugin(ScrollTrigger);
        const mm = gsap.matchMedia();

        // ---- menu: rolagem animada até a seção
        scrollTo.current = (target) => {
          const position = { y: window.scrollY };
          const y = target.getBoundingClientRect().top + window.scrollY;
          const distance = Math.abs(y - position.y);
          gsap.to(position, {
            y,
            duration: Math.min(1.4, 0.5 + distance / 4000),
            ease: 'power3.inOut',
            onUpdate: () => window.scrollTo(0, position.y),
          });
        };

        mm.add(
          { desktop: '(min-width: 721px)', phone: '(max-width: 720px)' },
          (context) => {
            const { desktop } = context.conditions as { desktop: boolean };

            // ---- primeira tela: a porta se abre
            const hero = el.querySelector('.lp-hero');
            if (hero) {
              const door = gsap.timeline({
                defaults: { ease: 'none' },
                scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 },
              });
              door.to('.lp-frame', { scale: desktop ? 1.5 : 1.15 }, 0);
              if (desktop) {
                door
                  .to('.lp-word-move.is-first', { xPercent: -28 }, 0)
                  .to('.lp-word-move.is-last', { xPercent: 28 }, 0);
              }
              door.to('.lp-hero-foot', { autoAlpha: 0, y: -40 }, 0);
            }

            // ---- deploy: presa na tela, a rolagem escolhe a etapa
            const deploy = el.querySelector<HTMLElement>('.lp-deploy');
            if (deploy && desktop && stages > 1) {
              const last = stages - 1;
              const pin = ScrollTrigger.create({
                trigger: deploy,
                start: 'top top',
                end: () => `+=${window.innerHeight * 1.6}`,
                pin: true,
                snap: { snapTo: 1 / last, duration: { min: 0.15, max: 0.5 }, ease: 'power1.inOut' },
                onUpdate: (self) => onStageRef.current(Math.round(self.progress * last)),
              });
              goTo.current = (index) => {
                // dentro do trecho preso (nas pontas a seção solta e a etapa não muda)
                const top = Math.min(
                  pin.end - 2,
                  Math.max(pin.start + 2, pin.start + ((pin.end - pin.start) * index) / last),
                );
                // Rolagem animada pelo próprio GSAP: a "suave" do navegador é cancelada pelo encaixe (snap)
                const position = { y: window.scrollY };
                gsap.to(position, {
                  y: Math.round(top),
                  duration: 0.7,
                  ease: 'power2.inOut',
                  onUpdate: () => window.scrollTo(0, position.y),
                });
                return true;
              };
              return () => {
                goTo.current = null;
              };
            }
            return undefined;
          },
          el,
        );

        // ---- números: contam até o valor (uma vez)
        const counters = gsap.context(() => {
          gsap.utils.toArray<HTMLElement>('.lp-figure-value').forEach((figure) => {
            const value = Number(figure.dataset.value);
            const whole = figure.querySelector('.lp-whole');
            if (!whole || !Number.isFinite(value)) return;
            const counter = { v: 0 };
            gsap.to(counter, {
              v: value,
              duration: 1.4,
              ease: 'power2.out',
              onStart: () => (whole.textContent = '0'),
              onUpdate: () => (whole.textContent = String(Math.round(counter.v))),
              scrollTrigger: { trigger: figure, start: 'top 88%', once: true },
            });
          });
        }, el);

        revert = () => {
          counters.revert();
          mm.revert();
        };
        ScrollTrigger.refresh();
        // As posições mudam quando a fonte da web e as imagens terminam de carregar
        void document.fonts?.ready.then(() => !cancelled && ScrollTrigger.refresh());
        if (document.readyState !== 'complete') {
          window.addEventListener('load', () => !cancelled && ScrollTrigger.refresh(), {
            once: true,
          });
        }
      })
      .catch((error: unknown) => {
        // movimento é enfeite: se o GSAP falhar, a página continua inteira, só sem animação
        console.warn('[landing] movimento desligado:', error);
      });

    return () => {
      cancelled = true;
      revert?.();
      goTo.current = null;
      scrollTo.current = null;
    };
  }, [root, stages]);

  const scrollToId = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    // Sem o GSAP (ainda carregando, ou movimento reduzido): a rolagem do próprio navegador
    if (scrollTo.current) scrollTo.current(target);
    else {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    }
  };

  return { goToStage: goTo, scrollToId };
}
