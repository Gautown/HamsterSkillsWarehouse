<script setup lang="ts">
/**
 * Layout.vue — 包装默认主题 Layout：
 * 1. 通过 nav-bar-content-before 插槽把官方 VPNavBarTitle 注入 content-body 首位，
 *    使「标题」与「搜索框」同容器（DOM：标题 → 搜索 → 菜单 → 右侧按钮组）。
 * 2. 直接 import 官方 Layout.vue（不经过 'vitepress/theme' 入口，
 *    避免重复加载官方全局 CSS —— 全局样式已汇总在 ./theme.css）。
 * 原生 .title 容器由 style.css 隐藏（≥960px）。
 */
// 直接引用官方组件文件（vitepress exports ./dist/* 全开放）
import OfficialLayout from 'vitepress/dist/client/theme-default/Layout.vue';
import VPNavBarTitle from 'vitepress/dist/client/theme-default/components/VPNavBarTitle.vue';

defineExpose({ OfficialLayout });
</script>

<template>
  <OfficialLayout>
    <!-- 标题注入到 content-body 首位，与搜索框同容器 -->
    <template #nav-bar-content-before>
      <VPNavBarTitle class="custom-nav-title" />
    </template>

    <!-- 其余 navbar 插槽保持透传（不覆盖则不渲染额外内容） -->
    <template #nav-bar-title-before><slot name="nav-bar-title-before" /></template>
    <template #nav-bar-title-after><slot name="nav-bar-title-after" /></template>
    <template #nav-bar-content-after><slot name="nav-bar-content-after" /></template>
  </OfficialLayout>
</template>
