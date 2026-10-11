import { useEffect, useRef } from 'react';
import { dot, geometry, orient, type Vec } from './geometry.js';
import { roundedGeometry, type RoundedDie } from './rounded.js';
import { drawIvoryDie, type DiceQuality } from './ivory.js';
import {
  makeDieMotion,
  restingPose,
  sampleDieMotion,
  type DieMotionImpact,
  type DieMotionTrack,
} from './motion.js';
import { dieAnchor, diceColumns, type SafeInsets } from './layout.js';

export type VisualDie = {
  value: number;
  sides: number;
  name?: string;
  color: string;
  percent?: boolean;
  symbol?: boolean;
};
type Point = [number, number];
const HEIGHT_SCALE = 0.07;
const HEIGHT_LIFT = 0.42;
const fastMeshes = new Map<number, RoundedDie>();
function fastGeometry(sides: number) {
  let mesh = fastMeshes.get(sides);
  if (!mesh) {
    const faces = geometry(sides);
    mesh = { faces, surfaces: faces.map((face, faceIndex) => ({ ...face, faceIndex })) };
    fastMeshes.set(sides, mesh);
  }
  return mesh;
}
const smooth = (n: number) => {
  const p = Math.max(0, Math.min(1, n));
  return p * p * (3 - 2 * p);
};

export function DiceCanvas({
  dice,
  seed,
  animate,
  onFinish,
  onImpacts,
  resultSpace = 300,
}: {
  dice: VisualDie[];
  seed: string;
  animate: boolean;
  onFinish: () => void;
  /** Every strike on the table in this throw, reported once before it starts. */
  onImpacts?: (impacts: DieMotionImpact[]) => void;
  resultSpace?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const impacts = useRef(onImpacts);
  impacts.current = onImpacts;
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
    let safe: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    let frame = 0;
    let stopped = false;
    let completed = false;
    let quality: DiceQuality = dice.length >= 12 ? 'fast' : dice.length >= 6 ? 'balanced' : 'full';
    let slowFrames = 0;
    let hash = Array.from(seed).reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
    const random = () => {
      hash ^= hash << 13;
      hash ^= hash >>> 17;
      hash ^= hash << 5;
      return (hash >>> 0) / 4294967296;
    };
    // A still result needs no throw.
    const motions: (DieMotionTrack | undefined)[] = dice.map((die) => {
      const dieSeed = Math.floor(random() * 4294967296);
      return animate ? makeDieMotion(dieSeed, die.sides) : undefined;
    });
    const duration = Math.max(0.001, ...motions.map((motion) => motion?.duration ?? 0));
    if (animate)
      impacts.current?.(
        motions.flatMap((motion) => [...(motion?.impacts ?? [])]).sort((a, b) => a.time - b.time),
      );
    const meshCache = new Map<RoundedDie, { anchor: Point; bottom: number }>();
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
        info = { anchor, bottom };
        meshCache.set(mesh, info);
      }
      return info;
    }
    function draw(elapsed: number) {
      ctx.clearRect(0, 0, width, height);
      const landscape = height < 500 && width > height;
      // Keep the tray inside the safe area, so no die settles beneath a
      // camera notch or rounded corner. The heading and scorecard already
      // respect the same insets.
      const trayLeft = safe.left;
      const safeWidth = width - safe.left - safe.right;
      const trayWidth = landscape ? Math.max(160, safeWidth - 340) : safeWidth;
      const trayTop = Math.max(65, safe.top + 45);
      const reserved =
        trayTop -
        65 +
        Math.max(0, safe.bottom - 16) +
        (landscape ? 100 : Math.min(resultSpace, height * 0.57) + 85);
      const space = Math.max(110, height - reserved);
      const columns = diceColumns(dice.length, trayWidth, space);
      const center: Point = [trayLeft + trayWidth / 2, trayTop + space / 2];
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
        const motion = motions[index];
        const pose = motion ? sampleDieMotion(motion, elapsed) : restingPose;
        const rowColumns = Math.min(columns, dice.length - Math.floor(index / columns) * columns);
        const [targetX, targetY] = dieAnchor(
          center,
          [
            trayLeft + trayWidth * (((index % columns) + 0.5) / rowColumns),
            trayTop + cellHeight * (Math.floor(index / columns) + 0.5),
          ],
          elapsed,
          duration,
        );
        // A die nearer the overhead camera looks larger.
        const scale = radius * (1 + pose.z * HEIGHT_SCALE);
        // At crowded sizes, subpixel fillets add cost without visible detail.
        // Keep the closed solid and recorded faces; only its finish is simpler.
        const mesh =
          quality === 'fast'
            ? fastGeometry(die.sides)
            : roundedGeometry(die.sides, quality === 'balanced' || radius < 24 ? 2 : 4);
        const base = mesh.faces[0];
        const info = meshInfo(mesh);
        // Combine the simulated attitude with the result face's own frame once,
        // rather than for every point, fillet and lighting normal in each frame.
        const rotationRows = pose.rotation.map((row): Vec => [
          row[0] * base.u[0] + row[1] * base.v[0] + row[2] * base.normal[0],
          row[0] * base.u[1] + row[1] * base.v[1] + row[2] * base.normal[1],
          row[0] * base.u[2] + row[1] * base.v[2] + row[2] * base.normal[2],
        ]);
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
        // The table is seen from above: travel across it moves the die on
        // screen, and height lifts it away from the shadow it leaves behind.
        const x = targetX + pose.x * radius;
        const groundY = targetY - pose.y * radius;
        const floorY = groundY + info.bottom * radius;
        const y = groundY - pose.z * radius * HEIGHT_LIFT;
        const project = (v: Vec): Point => {
          const p = local(v);
          return [x + p[0] * scale, y + p[1] * scale];
        };
        const shadowY = floorY - info.bottom * radius * 0.55;
        return { die, pose, x, floorY, shadowY, scale, mesh, rotate, project };
      });
      // Dice in the air pass over the ones already on the table.
      renders.sort((a, b) => a.pose.z - b.pose.z || a.floorY - b.floorY);
      const arriving = animate ? smooth(elapsed / 0.12) : 1;
      for (const { die, pose, x, floorY, shadowY, scale, mesh, rotate, project } of renders) {
        ctx.globalAlpha = arriving;
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
        drawIvoryDie(ctx, mesh, project, rotate, die, scale, quality);
        ctx.globalAlpha = 1;
        if (die.name && showNames && pose.settle > 0) {
          ctx.save();
          ctx.globalAlpha = smooth(pose.settle);
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
      // The dice screen pads itself by the safe-area insets; read them back.
      const style = getComputedStyle(element.parentElement ?? element);
      safe = {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0,
      };
      const ratio = Math.min(
        devicePixelRatio || 1,
        quality === 'fast' ? 1 : quality === 'balanced' ? 1.5 : 2,
      );
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (completed) draw(duration);
    }
    const start = performance.now();
    function tick(now: number) {
      if (stopped) return;
      const elapsed = animate ? Math.min(duration, (now - start) / 1000) : duration;
      if (!document.hidden) {
        const began = performance.now();
        draw(elapsed);
        slowFrames = performance.now() - began > 24 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
        if (slowFrames >= 2 && quality !== 'fast') {
          quality = quality === 'full' ? 'balanced' : 'fast';
          slowFrames = 0;
          resize();
        }
      }
      if (elapsed < duration) frame = requestAnimationFrame(tick);
      else {
        completed = true;
        finish.current();
      }
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const visible = () => {
      if (completed && !document.hidden) draw(duration);
    };
    document.addEventListener('visibilitychange', visible);
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [dice, seed, animate, resultSpace]);
  return <canvas className="dice-canvas" ref={canvas} aria-hidden="true" />;
}
