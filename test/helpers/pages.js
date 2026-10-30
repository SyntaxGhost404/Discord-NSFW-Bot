// Small pages in the shape of the source site's desktop markup.

export const IMAGE_HOST = 'https://static17.hentai-cosplay-xxx.com';
export const VIDEO_HOST = 'https://static03.videos-uploader.com';

export function item({ kind = 'image', slug, title, image, date = '2026/10/30' }) {
  return `<li> <div class="image-list-item"> <div class="image-list-item-image"> <a href="/${kind}/${slug}/"> <img src="${image}" alt="${title}" loading="lazy" decoding="async"/> </a> </div>
    <p class="image-list-item-title"> <a href="/${kind}/${slug}/">${title}</a> </p>
    <p class="image-list-item-regist-date"> <span>${date}</span> </p> </div> </li>`;
}

function heading(title, { count = null, readMore = null } = {}) {
  const extra = readMore
    ? `<span id="articles_number"> <a href="${readMore}"> Read More </a> </span>`
    : count === null ? '' : `<span id="articles_number"><span class="immoral_all_items">${count}</span> items</span>`;
  return `<div id="post_list_title"> ${title} ${extra} </div>`;
}

const list = (items) => `<ul id="image-list" class="clearfix">${items.join('\n')}</ul>`;

const sidebar = () => [
  heading('Recent Downloads', { readMore: '/recently-download/' }),
  list([item({ slug: 'sidebar-album', title: 'Sidebar album', image: `${IMAGE_HOST}/upload/20260101/400/400000/p=160x200/1.webp` })]),
].join('\n');

// A listing page: the main list (if any) comes first, then a sidebar list
// that must never be read.
export function listingPage({ title = 'New Images', count = null, items = [], next = false, main = true } = {}) {
  return `<!doctype html><html><head><title>Hentai Cosplay</title>
    ${next ? '<link rel="next" href="https://hentai-cosplay-xxx.com/search/page/2/"/>' : ''}
    <script src="//static.hentai-cosplay-xxx.com/js/common/jquery-2.2.4.min.js"></script></head>
    <body><div id="adsense_center"><script>alert(1)</script></div>
    ${main ? `${heading(title, { count })}\n${list(items)}` : heading(title, { count: 0 })}
    ${sidebar()}
    </body></html>`;
}

export function storyPage({ title = 'Album', poster, images = [] }) {
  const pages = images.map((src) => `<amp-story-page><amp-story-grid-layer template="fill"><amp-img class="auto-style" src="${src}" width="1" height="1" layout="responsive"></amp-img></amp-story-grid-layer></amp-story-page>`);
  return `<!doctype html><html amp><head><script async src="https://cdn.ampproject.org/v0.js"></script></head><body>
    <amp-story standalone supports-landscape title="${title}" publisher="Hentai Cosplay" publisher-logo-src="https://static.hentai-cosplay-xxx.com/img/common/logo.png"${poster ? ` poster-portrait-src="${poster}"` : ''}>
    ${pages.join('\n')}
    </amp-story></body></html>`;
}

export function videoPage({ title = 'Clip', poster, stream, h1 = true }) {
  return `<!doctype html><html><head><title>${title} - Hentai Cosplay</title></head><body>
    ${h1 ? `<h1 id="post_title">${title}</h1>` : ''}
    <video id="video_1" controls preload="auto"${poster ? ` poster="${poster}"` : ''}>
    ${stream ? `<source src="${stream}" type="application/x-mpegURL">` : ''}
    </video></body></html>`;
}
