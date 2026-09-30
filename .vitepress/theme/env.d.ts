/**
 * env.d.ts — 主题模块类型声明
 *
 * 让 `tsc --noEmit` 认识 .vue 单文件组件与 CSS 导入（Vite 在构建期处理，
 * 但独立跑 tsc 时没有对应的模块声明，会报 TS2307）。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

declare module '*.css';

declare module '*.json' {
  const value: unknown;
  export default value;
}
