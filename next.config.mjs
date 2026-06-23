/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Safety net: emit browser source maps in production so the next
  // unhandled exception (e.g. a recurrence of the React #310 we
  // couldn't pin down without one) surfaces real component + file +
  // line in the browser console instead of minified frames. Adds a
  // small build-time cost; .map files aren't requested by browsers
  // unless devtools are open.
  productionBrowserSourceMaps: true,
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
