// Small pages in the shape of xHamster's: the data its scripts read, as JSON
// in `window.initials`, with slashes escaped the way the site writes them.

export const XH_IMAGE = 'https://ic-ph-nss.xhcdn.com/a/ZmFrZQ/jpeg/000/520/370';

const page = (initials) => `<!doctype html><html><head><title>Photos</title>
  <script>window.ads = {};</script></head><body><div id="app"></div>
  <script>window.initials = ${JSON.stringify(initials).replace(/\//g, '\\/')};</script>
  <script src="https://static-ah.xhcdn.com/app.js"></script></body></html>`;

const slugOf = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A gallery as Best and Newest list it.
export function xhGallery({ id, title = `Gallery ${id}`, count = 12, image = `${XH_IMAGE}/${id}_1000.jpg`, ...extra }) {
  return {
    id,
    link: `https://xhamster.com/photos/gallery/${slugOf(title)}-${id}`,
    title,
    imgSrc: image,
    imgSrcset: image.replace('_1000', '_450'),
    photosCount: count,
    viewsText: '1K views',
    isPublic: true,
    isGeoBlocked: false,
    ...extra,
  };
}

export const xhListPage = ({ items, page: current = 1, last = 1 }) => page({
  photosPage: { galleriesItems: items, paginationProps: { currentPageNumber: current, lastPageNumber: last } },
});

// Search results list galleries under other names.
export const xhSearchPage = ({ items, page: current = 1, pages = 1, summary = `${items.length} Results` }) => page({
  searchTitleSummaryComponent: { title: 'Photos', resultCount: summary },
  searchResultsPhotoComponent: {
    list: items.map((item) => ({ id: item.id, pageURL: item.link, imageURL: item.imgSrc, thumbURL: item.imgSrcset, titleLocalized: item.title, imgCount: item.photosCount, isDeleted: false, isGeoBlocked: false })),
    pagination: { active: current, next: current + 1, maxPages: pages },
  },
});

// A Top list ranks single photos, each with its gallery.
export const xhTopPage = ({ photos }) => page({
  layoutPage: { title: 'Weekly Top Rated Photos', photoListProps: { items: photos } },
});

export const xhRanked = ({ id, galleryId, alt = `Gallery ${galleryId}` }) => ({
  id,
  galleryId,
  link: `https://xhamster.com/photos/gallery/${galleryId}/${id}`,
  imgSrc: `${XH_IMAGE}/${id}_1000.jpg`,
  imgSrcset: `${XH_IMAGE}/${id}_450.jpg`,
  alt,
  originWidth: 1000,
  originHeight: 1500,
});

export const xhPhoto = (id, { width = 2000, height = 1333, src = `${XH_IMAGE}/${id}_1000.jpg`, ...extra } = {}) => ({
  id,
  imgSrc: src,
  imgSrcset: src.replace('_1000', '_450'),
  originWidth: width,
  originHeight: height,
  alt: 'Gallery',
  isGeoBlocked: false,
  ...extra,
});

export const xhGalleryPage = ({ key, title = 'Gallery', created = 1_792_540_800, count, page: current = 1, pages = 1, photos }) => page({
  galleryPage: {
    id: Number(key.split('-').at(-1)),
    photosPerPage: 60,
    photosCount: count ?? photos.length,
    photoItems: photos,
    breadCrumbsProps: { breadCrumbs: [{ name: 'uploader' }, { name: 'Galleries' }, { name: title }], lastCrumbTagName: 'h1' },
    infoProps: { authorInfoProps: { createdDate: created, authorName: 'uploader' } },
    paginationProps: { currentPageNumber: current, lastPageNumber: pages, pageLinkTemplate: `https://xhamster.com/photos/gallery/${key}/{#}`, pageLinkFirst: `https://xhamster.com/photos/gallery/${key}` },
  },
});
