import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'AgentEval',
  description:
    'Reliability and audit-ready testing for LLM agents: determinism scoring, grounding checks, audit-ready reports.',
  base: '/agenteval/',
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/assertions' },
      { text: 'Case study', link: '/case-studies/25-percent-determinism' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Core concepts', link: '/guide/concepts' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Assertions', link: '/reference/assertions' },
          { text: 'Configuration and CLI', link: '/reference/config' },
        ],
      },
      {
        text: 'Case studies',
        items: [
          {
            text: 'A web agent at 25% determinism',
            link: '/case-studies/25-percent-determinism',
          },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/lokesh75-kank/agenteval' }],
    editLink: {
      pattern: 'https://github.com/lokesh75-kank/agenteval/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
    },
    search: { provider: 'local' },
  },
});
