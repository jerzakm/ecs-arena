// Dev server for the project page (pnpm site:dev). /viewer is proxied to the viewer's own dev server.
export default {
  server: { port: 5173, proxy: { '/viewer': { target: 'http://localhost:5174', ws: true } } },
}
