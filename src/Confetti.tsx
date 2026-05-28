import { useEffect } from 'react';

const Confetti: React.FC<{ trigger: boolean }> = ({ trigger }) => {
  useEffect(() => {
    if (!trigger) return;

    const canvas = document.getElementById('confetti-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const confetti: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      color: string;
      opacity: number;
    }> = [];

    const colors = ['#c8a96b', '#f8e8e8', '#fffaf5', '#5a321b'];

    for (let i = 0; i < 18; i++) {
      confetti.push({
        x: Math.random() * canvas.width,
        y: -10,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 2.5 + 2,
        size: Math.random() * 7 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: 0.75,
      });
    }

    let animationId: number;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      confetti.forEach((c, index) => {
        c.y += c.vy;
        c.x += c.vx;
        c.vy += 0.045;
        c.opacity -= 0.02;

        if (c.opacity <= 0 || c.y > canvas.height) {
          confetti.splice(index, 1);
        }

        ctx.save();
        ctx.globalAlpha = c.opacity;
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      if (confetti.length > 0) {
        animationId = requestAnimationFrame(animate);
      }
    };

    animate();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [trigger]);

  return <canvas id="confetti-canvas" style={{ position: 'fixed', top: 0, left: 0, pointerEvents: 'none' }} />;
};

export default Confetti;
