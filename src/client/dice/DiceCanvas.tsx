import { useEffect, useRef } from 'react';
import { dot, orient, rollSpin, type Vec } from './geometry.js';
import { roundedGeometry, type RoundedDie } from './rounded.js';
import { drawIvoryDie } from './ivory.js';
import { makeDieMotion, sampleDieMotion } from './motion.js';

export type VisualDie = {
  value: number;
  sides: number;
  name?: string;
  color: string;
  percent?: boolean;
  symbol?: boolean;
};
type Point = [number, number];
const smooth = (n: number) => {
  const p = Math.max(0, Math.min(1, n));
  return p * p * (3 - 2 * p);
};

export function DiceCanvas({
  dice,
  seed,
  animate,
  onFinish,
  resultSpace = 300,
}: {
  dice: VisualDie[];
  seed: string;
  animate: boolean;
  onFinish: () => void;
  resultSpace?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useEffect(() => {
    const element = canvas.current!;
    const context = element.getContext('2d');
    if (!context) {
      finish.current();
      return;
    }
    const ctx = context;
    let width = innerWidth;
    let height = innerHeight;
    let frame = 0;
    let stopped = false;
    let completed = false;
    let hash = Array.from(seed).reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
    const random = () => {
      hash ^= hash << 13;
      hash ^= hash >>> 17;
      hash ^= hash << 5;
      return (hash >>> 0) / 4294967296;
    };
    const bodies = dice.map((die) => {
      const dieSeed = random();
      return { seed: dieSeed, motion: makeDieMotion(Math.floor(dieSeed * 4294967296), die.sides === 2) };
    });
    const duration = Math.max(0.001, ...bodies.map((body) => body.motion.duration));
    const meshCache = new Map<RoundedDie, { vertices: Vec[]; anchor: Point; bottom: number }>();
    const perspective = (v: Vec): Point => {
      const factor = 4.8 / (4.8 - v[2]);
      return [v[0] * factor, -v[1] * factor];
    };
    function meshInfo(mesh: RoundedDie) {
      let info = meshCache.get(mesh);
      if (!info) {
        const vertices = [
          ...new Map(
            mesh.surfaces.flatMap((surface) => surface.points).map((v) => [v.join(','), v]),
          ).values(),
        ];
        const base = mesh.faces[0];
        // A constant camera offset centers an asymmetric d10's result face.
        // It does not pull the solid toward the camera during its final roll.
        const anchor = perspective(orient(base.center, base, [0, 0, 0]));
        const bottom = Math.max(
          ...vertices.map((v) => perspective(orient(v, base, [0, 0, 0]))[1] - anchor[1]),
        );
        info = { vertices, anchor, bottom };
        meshCache.set(mesh, info);
      }
      return info;
    }
    function draw(elapsed: number) {
      ctx.clearRect(0, 0, width, height);
      const landscape = height < 500 && width > height;
      const trayWidth = landscape ? Math.max(160, width - 340) : width;
      const space = Math.max(110, height - (landscape ? 100 : Math.min(resultSpace, height * 0.57) + 85));
      const columns =
        dice.length > 10
          ? Math.max(2, Math.round(Math.sqrt((dice.length * trayWidth) / space)))
          : Math.min(dice.length, trayWidth < 520 ? (height < 650 && dice.length >= 6 ? 3 : 2) : 4);
      const rows = Math.ceil(dice.length / columns);
      const cellHeight = space / rows;
      const showNames = dice.length <= 10;
      const labelHeight = cellHeight < 85 ? 18 : 24;
      const cellRadius =
        showNames && dice.some((die) => die.name) ? (cellHeight - labelHeight - 14) / 2 : cellHeight * 0.35;
      const radius = Math.max(
        5,
        Math.min(dice.length === 1 ? 90 : 63, (trayWidth / columns) * 0.34, cellRadius),
      );
      const renders = dice.map((die, index) => {
        const body = bodies[index];
        const pose = sampleDieMotion(body.motion, elapsed);
        const rowColumns = Math.min(columns, dice.length - Math.floor(index / columns) * columns);
        const targetX = trayWidth * (((index % columns) + 0.5) / rowColumns);
        const targetY = 65 + cellHeight * (Math.floor(index / columns) + 0.5);
        const spin = rollSpin(1 - pose.rotation, body.seed);
        if (die.sides === 2) {
          spin[0] *= 1.5;
          spin[1] *= 0.1;
          spin[2] *= 0.24;
        }
        const scale = radius * (1 + pose.z * 0.025);
        const mesh = roundedGeometry(die.sides, radius < 24 ? 2 : 4);
        const base = mesh.faces[0];
        const info = meshInfo(mesh);
        // Precompute the rotation matrix once, rather than trigonometry for
        // every point, fillet and lighting normal in each animation frame.
        const axes = (
          [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ] as Vec[]
        ).map((v) => orient(v, base, spin));
        const rotationRows: Vec[] = [0, 1, 2].map((axis) => [axes[0][axis], axes[1][axis], axes[2][axis]]);
        const rotate = (v: Vec): Vec => [
          dot(v, rotationRows[0]),
          dot(v, rotationRows[1]),
          dot(v, rotationRows[2]),
        ];
        const projected = new Map<Vec, Point>();
        const local = (v: Vec): Point => {
          let point = projected.get(v);
          if (!point) {
            const p = perspective(rotate(v));
            point = [p[0] - info.anchor[0], p[1] - info.anchor[1]];
            projected.set(v, point);
          }
          return point;
        };
        const support = Math.max(...info.vertices.map((v) => local(v)[1]));
        const x = targetX + pose.x * radius;
        const floorY = targetY + pose.y * radius + info.bottom * radius;
        // The lowest vertex stays on the contact plane while the solid rolls.
        // Only ballistic elevation separates the die from its fixed shadow.
        const y = floorY - support * scale - pose.z * radius * 0.48;
        const project = (v: Vec): Point => {
          const p = local(v);
          return [x + p[0] * scale, y + p[1] * scale];
        };
        const shadowY = floorY - info.bottom * radius * 0.55;
        return { die, pose, x, floorY, shadowY, scale, mesh, rotate, project };
      });
      renders.sort((a, b) => a.floorY - b.floorY);
      for (const { die, pose, x, floorY, shadowY, scale, mesh, rotate, project } of renders) {
        ctx.save();
        // The camera sees the result face from above. Its table shadow extends
        // beneath the solid, rather than suggesting a die balanced on a tip.
        ctx.translate(x + radius * (0.06 + pose.z * 0.04), shadowY);
        ctx.scale(radius * (0.9 + pose.z * 0.16), radius * (0.62 + pose.z * 0.075));
        const shadow = ctx.createRadialGradient(0, 0, 0.05, 0, 0, 1);
        shadow.addColorStop(0, `rgba(0,2,6,${0.46 / (1 + pose.z * 0.9)})`);
        shadow.addColorStop(0.5, `rgba(0,2,6,${0.14 / (1 + pose.z)})`);
        shadow.addColorStop(1, 'rgba(0,2,6,0)');
        ctx.fillStyle = shadow;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (pose.grounded) {
          ctx.save();
          ctx.translate(x, shadowY);
          ctx.scale(radius * 0.65, radius * 0.42);
          const contact = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          contact.addColorStop(0, 'rgba(0,1,4,.4)');
          contact.addColorStop(1, 'rgba(0,1,4,0)');
          ctx.fillStyle = contact;
          ctx.beginPath();
          ctx.arc(0, 0, 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        drawIvoryDie(ctx, mesh, project, rotate, die, scale);
        if (die.name && showNames) {
          ctx.save();
          ctx.globalAlpha = smooth((0.1 - pose.rotation) / 0.1);
          ctx.font = `600 ${labelHeight === 18 ? 10 : 12}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const label = die.name.length > 19 ? die.name.slice(0, 18) + '…' : die.name;
          const labelWidth = Math.min(trayWidth / columns - 12, ctx.measureText(label).width + 20);
          ctx.fillStyle = 'rgba(8,12,20,.9)';
          ctx.beginPath();
          ctx.roundRect(x - labelWidth / 2, floorY + 7, labelWidth, labelHeight, 8);
          ctx.fill();
          ctx.strokeStyle = 'rgba(241,218,165,.3)';
          ctx.lineWidth = 0.7;
          ctx.stroke();
          ctx.fillStyle = '#f8ebd0';
          ctx.fillText(label, x, floorY + 7 + labelHeight / 2, labelWidth - 10);
          ctx.restore();
        }
      }
    }
    function resize() {
      const rect = element.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (completed) draw(duration);
    }
    const start = performance.now();
    function tick(now: number) {
      if (stopped) return;
      const elapsed = animate ? Math.min(duration, (now - start) / 1000) : duration;
      if (!document.hidden) draw(elapsed);
      if (elapsed < duration) frame = requestAnimationFrame(tick);
      else {
        draw(duration);
        completed = true;
        finish.current();
      }
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [dice, seed, animate, resultSpace]);
  return <canvas className="dice-canvas" ref={canvas} aria-hidden="true" />;
}
