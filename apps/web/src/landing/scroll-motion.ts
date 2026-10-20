/**
 * Movimento ligado à rolagem da página inicial (GSAP + ScrollTrigger).
 *
 * O GSAP é baixado só aqui (import dinâmico): o painel não carrega nada disso. Com
 * "reduzir movimento" ligado no sistema, nada roda e a página fica como está (o deploy
 * continua no controle deslizante).
 *
 *  - Primeira tela: a janela de login dentro do nome se abre e as palavras se afastam.
 *  - Recursos: as telas do painel deslizam devagar dentro da moldura (paralaxe).
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

export function useScrollMotion({ root, stages, onStage }: Options): RefObject<GoToStage | null> {
  const goTo = useRef<GoToStage | null>(null);
  const onStageRef = useRef(onStage);
  onStageRef.current = onStage;

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let revert: (() => void) | undefined;
    let cancelled = false;

    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(
      ([{ gsap }, { ScrollTrigger }]) => {
        if (cancelled) return;
        gsap.registerPlugin(ScrollTrigger);
        const mm = gsap.matchMedia();

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

            // ---- recursos: paralaxe das telas
            gsap.utils.toArray<HTMLElement>('.lp-parallax').forEach((media) => {
              gsap.fromTo(
                media,
                { yPercent: -6 },
                {
                  yPercent: 6,
                  ease: 'none',
                  scrollTrigger: {
                    trigger: media.parentElement,
                    start: 'top bottom',
                    end: 'bottom top',
                    scrub: true,
                  },
                },
              );
            });

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
          const lang = document.documentElement.lang || 'pt-BR';
          gsap.utils.toArray<HTMLElement>('.lp-figure-value').forEach((figure) => {
            const value = Number(figure.dataset.value);
            const decimals = Number(figure.dataset.decimals ?? 0);
            const whole = figure.querySelector('.lp-whole');
            const rest = figure.querySelector('.lp-decimals');
            if (!whole || !Number.isFinite(value)) return;
            const format = new Intl.NumberFormat(lang, {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            });
            const counter = { v: 0 };
            const paint = () => {
              const text = format.format(counter.v);
              const [w, d] = text.split(/[.,](?=\d+$)/);
              whole.textContent = w ?? text;
              if (rest) rest.textContent = d ? text.charAt((w ?? '').length) + d : '';
            };
            gsap.to(counter, {
              v: value,
              duration: 1.4,
              ease: 'power2.out',
              onUpdate: paint,
              scrollTrigger: { trigger: figure, start: 'top 88%', once: true },
              onStart: paint,
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
      },
    );

    return () => {
      cancelled = true;
      revert?.();
      goTo.current = null;
    };
  }, [root, stages]);

  return goTo;
}
