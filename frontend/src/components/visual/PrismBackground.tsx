import React, { useEffect, useRef } from 'react';
import { Mesh, Program, Renderer, Triangle } from 'ogl';

interface PrismBackgroundProps {
  className?: string;
  intensity?: number;
  speed?: number;
  hueShift?: number;
  interactive?: boolean;
}

// Adapted from React Bits Prism (DavidHDev/react-bits), MIT + Commons Clause.
export const PrismBackground: React.FC<PrismBackgroundProps> = ({
  className = '',
  intensity = 0.8,
  speed = 0.18,
  hueShift = -0.28,
  interactive = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.innerWidth < 768 ? 1.1 : 1.5, window.devicePixelRatio || 1);
    const renderer = new Renderer({ dpr, alpha: true, antialias: false });
    const gl = renderer.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(gl.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
    });
    container.appendChild(gl.canvas);

    const vertex = `
      attribute vec2 position;
      void main() { gl_Position = vec4(position, 0.0, 1.0); }
    `;
    const fragment = `
      precision highp float;
      uniform vec2 uResolution;
      uniform vec2 uPointer;
      uniform float uTime;
      uniform float uIntensity;
      uniform float uHueShift;

      vec4 tanh4(vec4 x) {
        vec4 e = exp(2.0 * x);
        return (e - 1.0) / (e + 1.0);
      }

      float pyramid(vec3 p) {
        vec3 q = abs(p) / vec3(2.7, 3.4, 2.7);
        return (q.x + q.y + q.z - 1.0) * 1.56;
      }

      mat2 rotate2d(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat2(c, -s, s, c);
      }

      mat3 hueRotation(float a) {
        float c = cos(a), s = sin(a);
        mat3 w = mat3(0.299,0.587,0.114, 0.299,0.587,0.114, 0.299,0.587,0.114);
        mat3 u = mat3(0.701,-0.587,-0.114, -0.299,0.413,-0.114, -0.300,-0.588,0.886);
        mat3 v = mat3(0.168,-0.331,0.500, 0.328,0.035,-0.500, -0.497,0.296,0.201);
        return w + u * c + v * s;
      }

      void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / max(uResolution.y, 1.0);
        uv -= uPointer * 0.045;
        float t = uTime;
        float z = 5.0;
        vec4 glow = vec4(0.0);

        for (int i = 0; i < 76; i++) {
          vec3 p = vec3(uv * 9.0, z);
          p.xz *= rotate2d(t * 0.23);
          p.xy *= rotate2d(sin(t * 0.16) * 0.22);
          p.y += 0.8;
          float d = 0.11 + 0.21 * abs(max(pyramid(p), -p.y));
          z -= d;
          glow += (sin((p.y + z) * 0.82 + vec4(0.0, 1.2, 2.4, 3.6)) + 1.0) / d;
        }

        vec3 channelBalance = glow.rgb / max(dot(glow.rgb, vec3(1.0)), 0.001);
        glow = tanh4(glow * glow * (uIntensity * 0.78) / 1e5);
        float energy = max(max(glow.r, glow.g), glow.b);
        float spectralBand = clamp(
          0.5 + (channelBalance.r - channelBalance.b) * 4.4 + (channelBalance.g - 0.333) * 1.2,
          0.0,
          1.0
        );
        vec3 coolBand = vec3(0.035, 0.42, 0.68);
        vec3 warmBand = vec3(0.68, 0.10, 0.72);
        vec3 spectralColor = mix(coolBand, warmBand, spectralBand);
        vec3 color = spectralColor * (0.22 + energy * 1.08) + glow.rgb * 0.08;
        color = clamp(hueRotation(uHueShift) * color, 0.0, 1.0);
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = clamp(mix(vec3(luminance), color, 1.46), 0.0, 1.0);
        float edge = smoothstep(1.0, 0.12, length(uv * vec2(0.72, 1.0)));
        float alpha = clamp(energy * edge * 1.08, 0.0, 0.94);
        gl_FragColor = vec4(color, alpha);
      }
    `;

    const resolution = new Float32Array(2);
    const pointer = new Float32Array(2);
    const targetPointer = { x: 0, y: 0 };
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uResolution: { value: resolution },
        uPointer: { value: pointer },
        uTime: { value: 0 },
        uIntensity: { value: Math.max(0.1, intensity) },
        uHueShift: { value: hueShift },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const resize = () => {
      renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
      resolution[0] = gl.drawingBufferWidth;
      resolution[1] = gl.drawingBufferHeight;
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const onPointerMove = (event: PointerEvent) => {
      targetPointer.x = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      targetPointer.y = (0.5 - event.clientY / Math.max(window.innerHeight, 1)) * 2;
    };
    if (interactive && !reducedMotion) window.addEventListener('pointermove', onPointerMove, { passive: true });

    let frame = 0;
    let visible = true;
    const startedAt = performance.now();
    const render = (now: number) => {
      pointer[0] += (targetPointer.x - pointer[0]) * 0.035;
      pointer[1] += (targetPointer.y - pointer[1]) * 0.035;
      program.uniforms.uTime.value = reducedMotion ? 0.7 : (now - startedAt) * 0.001 * speed;
      renderer.render({ scene: mesh });
      if (visible && !reducedMotion) frame = requestAnimationFrame(render);
    };
    const observer = new IntersectionObserver(entries => {
      const nextVisible = entries.some(entry => entry.isIntersecting);
      if (nextVisible && !visible && !reducedMotion) frame = requestAnimationFrame(render);
      visible = nextVisible;
      if (!visible && frame) cancelAnimationFrame(frame);
    });
    observer.observe(container);
    frame = requestAnimationFrame(render);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      if (gl.canvas.parentElement === container) container.removeChild(gl.canvas);
    };
  }, [hueShift, intensity, interactive, speed]);

  return <div ref={containerRef} className={`prism-background ${className}`} />;
};
