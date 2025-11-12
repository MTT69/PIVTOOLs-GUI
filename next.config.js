module.exports = {
  output: 'export',
  images: { unoptimized: true }, // required for static export if using Next images
  // async rewrites() {
  //   return [
  //     {
  //       source: '/backend/:path*',
  //       destination: 'http://127.0.0.1:5000/:path*',
  //     },
  //   ]
  // }
}
