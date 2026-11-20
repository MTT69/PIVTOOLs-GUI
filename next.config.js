module.exports = {
  output: 'export',
  images: { unoptimized: true }, // required for static export if using Next images
  // `npm run lint` reports the lint findings; the build does not gate on them yet.
  // Until .eslintrc.json the flat eslint.config.mjs was never loaded, so the build
  // linted nothing; this keeps that build behaviour while the backlog is open.
  eslint: { ignoreDuringBuilds: true },
  // async rewrites() {
  //   return [
  //     {
  //       source: '/backend/:path*',
  //       destination: 'http://127.0.0.1:5000/:path*',
  //     },
  //   ]
  // }
}
