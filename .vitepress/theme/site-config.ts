/**
 * site-config.ts — 站点信息配置（标题/关键词/logo/导航/hero/页脚）的类型与默认值
 *
 * 唯一数据源：仓库根 `site.config.json`（git 跟踪，管理员可在 /publish/ 管理台修改）。
 * 数据流：
 *   site.config.json → scan-skills.ts 读取 → 注入 .vitepress/site-config.json（生成物）
 *   → 主题组件（Layout / SkillsHub）import 生成物读取
 *
 * 本模块只放类型与默认值，浏览器与服务端共用（不引 node:fs）。
 */

export interface NavItem {
  text: string;
  link: string;
}

export interface SiteConfig {
  /** 站点标题（顶栏 + <title>） */
  title: string;
  /** 站点描述 / 关键词说明（<meta name="description">） */
  description: string;
  /** SEO 关键词 */
  keywords: string[];
  /** 顶栏 logo 图片路径（public 下，如 /logo.png） */
  logo: string;
  /** 顶栏 logo 文字（显示在 logo 图片右侧） */
  logoText: string;
  /** 是否显示 logo 文字 */
  logoTextVisible: boolean;
  /** 站点图标 favicon 路径 */
  favicon: string;
  /** 顶栏导航菜单 */
  nav: NavItem[];
  /** 首页 hero 区 */
  hero: {
    /** hero 图片路径 */
    image: string;
    /** hero 主标题 */
    title: string;
    /** hero 副标题 */
    subtitle: string;
  };
  /** 页脚 */
  footer: {
    /** 版权信息 */
    copyright: string;
    /** 品牌/技术栈说明 */
    brand: string;
  };
  /** 社交链接（空字符串 = 不显示） */
  socialLinks: {
    github: string;
  };
}

/** 默认站点配置（site.config.json 缺失/字段缺失时兜底） */
export const DEFAULT_SITE_CONFIG: SiteConfig = {
  title: 'OpenSkillsWarehouse',
  description: 'OpenSkillsWarehouse 技能目录 —— 分类浏览 · 标签筛选 · 全文搜索',
  keywords: ['skills', 'agent', 'hermes', '技能仓库', 'AI'],
  logo: '/logo.png',
  logoText: 'OpenSkillsWarehouse',
  logoTextVisible: true,
  favicon: '/favicon.ico',
  nav: [
    { text: '首页', link: '/' },
    { text: '所有技能', link: '/skills/' },
    { text: '按标签', link: '/tags/' },
    { text: '发布技能', link: '/publish/' },
  ],
  hero: {
    image: '/hero-logo.png',
    title: 'OpenSkillsWarehouse',
    subtitle: '发现、搜索技能 —— 分类浏览 · 标签筛选 · 全文搜索',
  },
  footer: {
    copyright: '© 2026 OpenSkillsWarehouse',
    brand: 'Powered by VitePress + Bun',
  },
  socialLinks: { github: '' },
};

/** 合并用户配置与默认值（逐字段兜底，数组/对象做浅合并） */
export function mergeSiteConfig(partial: Partial<SiteConfig> | null | undefined): SiteConfig {
  const p = partial ?? {};
  return {
    title: p.title?.trim() || DEFAULT_SITE_CONFIG.title,
    description: p.description?.trim() || DEFAULT_SITE_CONFIG.description,
    keywords: Array.isArray(p.keywords) && p.keywords.length
      ? p.keywords.map(String).map(s => s.trim()).filter(Boolean)
      : DEFAULT_SITE_CONFIG.keywords,
    logo: p.logo?.trim() || DEFAULT_SITE_CONFIG.logo,
    logoText: p.logoText?.trim() || DEFAULT_SITE_CONFIG.logoText,
    logoTextVisible: typeof p.logoTextVisible === 'boolean' ? p.logoTextVisible : DEFAULT_SITE_CONFIG.logoTextVisible,
    favicon: p.favicon?.trim() || DEFAULT_SITE_CONFIG.favicon,
    nav: Array.isArray(p.nav) && p.nav.length
      ? p.nav
          .filter(n => n && typeof n.text === 'string' && typeof n.link === 'string')
          .map(n => ({ text: n.text.trim(), link: n.link.trim() }))
          .filter(n => n.text && n.link)
      : DEFAULT_SITE_CONFIG.nav,
    hero: {
      image: p.hero?.image?.trim() || DEFAULT_SITE_CONFIG.hero.image,
      title: p.hero?.title?.trim() || DEFAULT_SITE_CONFIG.hero.title,
      subtitle: p.hero?.subtitle?.trim() || DEFAULT_SITE_CONFIG.hero.subtitle,
    },
    footer: {
      copyright: p.footer?.copyright?.trim() || DEFAULT_SITE_CONFIG.footer.copyright,
      brand: p.footer?.brand?.trim() || DEFAULT_SITE_CONFIG.footer.brand,
    },
    socialLinks: {
      github: p.socialLinks?.github?.trim() || '',
    },
  };
}
