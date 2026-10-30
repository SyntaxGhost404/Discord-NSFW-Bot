import { describe, expect, it } from 'vitest';
import { cleanText, decodeEntities, parseListing, parseStory, parseVideo } from '../src/parse.js';
import { IMAGE_HOST, item, listingPage, storyPage, VIDEO_HOST, videoPage } from './helpers/pages.js';

const FOLDER = `${IMAGE_HOST}/upload/20260827/445/454887/`;

describe('cleanText', () => {
  it('strips tags, decodes entities, and collapses whitespace', () => {
    expect(cleanText('  <b>Fern</b>&amp;<i>Frieren</i>&nbsp;&#039;24&#x21;  \n')).toBe("Fern & Frieren '24!");
  });

  it('removes emoji and the characters that build them', () => {
    expect(cleanText('Bunny \u2665\ufe0f Girl \u{1f469}\u200d\u{1f467} \u{1f1ef}\u{1f1f5} 1\ufe0f\u20e3 \u{1f44d}\u{1f3fd}')).toBe('Bunny Girl 1');
  });

  it('turns a spaced dash or hyphen into a middle dot and any other dash into a hyphen', () => {
    expect(cleanText('Koneko Maru - Frieren')).toBe('Koneko Maru \u00b7 Frieren');
    expect(cleanText('Wuthering Waves \u2013 Hiyuki \u2014 HQ')).toBe('Wuthering Waves \u00b7 Hiyuki \u00b7 HQ');
    expect(cleanText('Vol.1\u20133 \u2015 Re:Zero -- Rem \uff0d x')).toBe('Vol.1-3 \u00b7 Re:Zero \u00b7 Rem \u00b7 x');
    expect(cleanText('Chun-Li and \u30b3\u30b9\u30d7\u30ec\u30fc')).toBe('Chun-Li and \u30b3\u30b9\u30d7\u30ec\u30fc');
    expect(cleanText('Album &#8211; Part 2')).toBe('Album \u00b7 Part 2');
    expect(cleanText('\u2e3a\u2e3b\ufe58')).toBe('---');
  });

  it('drops control characters and caps the length', () => {
    expect(cleanText('a\u0000b\u0007c')).toBe('a b c');
    expect(cleanText('x'.repeat(400))).toHaveLength(300);
    expect(cleanText(null)).toBe('');
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal, and hex entities and leaves invalid ones alone', () => {
    expect(decodeEntities('&lt;&GT;&quot;&apos;&#65;&#x42;')).toBe('<>"\'AB');
    expect(decodeEntities('&bogus; &#xD800; &#1114112; &#0;')).toBe('&bogus; &#xD800; &#1114112; &#0;');
  });
});

describe('parseListing', () => {
  const album = item({ slug: 'koneko-maru-frieren', title: 'Koneko Maru - Frieren \u2764\ufe0f', image: `${FOLDER}p=160x200/31.webp`, date: '2026/9/3' });
  const video = item({ kind: 'video', slug: 'cosplay-888', title: 'Cosplay 888 isn&#039;t long', image: `${VIDEO_HOST}/video/2026/1022/rLNoAx/p=160x200/image-001.jpg`, date: '' });

  it('reads the main list and never the sidebar lists', () => {
    const page = listingPage({ count: '312,831', items: [album, video], next: true });
    const result = parseListing(page);
    expect(result).toEqual({
      items: [
        {
          kind: 'album',
          slug: 'koneko-maru-frieren',
          title: 'Koneko Maru \u00b7 Frieren',
          date: '2026-09-03',
          cover: { small: `${FOLDER}p=305/31.webp`, large: `${FOLDER}31.webp` },
        },
        {
          kind: 'video',
          slug: 'cosplay-888',
          title: "Cosplay 888 isn't long",
          date: null,
          cover: {
            small: `${VIDEO_HOST}/video/2026/1022/rLNoAx/p=305/image-001.jpg`,
            large: `${VIDEO_HOST}/video/2026/1022/rLNoAx/p=700/image-001.jpg`,
          },
        },
      ],
      more: true,
      total: 312831,
    });
    expect(JSON.stringify(result)).not.toContain('sidebar');
  });

  it('skips duplicates and links it does not know, and drops covers from other hosts', () => {
    const foreign = item({ slug: 'foreign-cover', title: 'Foreign', image: 'https://ads.example/banner.jpg' });
    const odd = '<li><a href="/tag/cosplay/">Tag</a></li>';
    const result = parseListing(listingPage({ items: [album, album, odd, foreign] }));
    expect(result.items.map((entry) => entry.slug)).toEqual(['koneko-maru-frieren', 'foreign-cover']);
    expect(result.items[1].cover).toBeNull();
    expect(result.more).toBe(false);
    expect(result.total).toBeNull();
  });

  it('falls back to the image text, then the slug, for a missing title', () => {
    const noTitle = `<li><a href="/image/fallback-slug_name/"><img src="${FOLDER}p=160x200/2.webp" alt="From &amp; alt"/></a></li>`;
    const bare = `<li><a href="/image/only-a-slug/"><img src="${FOLDER}p=160x200/3.webp"/></a></li>`;
    const result = parseListing(listingPage({ items: [noTitle, bare] }));
    expect(result.items.map((entry) => entry.title)).toEqual(['From & alt', 'only a slug']);
  });

  it('returns an empty list for a search without results', () => {
    expect(parseListing(listingPage({ title: 'zzqq Search Results', main: false }))).toEqual({ items: [], more: false, total: null });
    expect(parseListing('<html><body>Not a listing</body></html>')).toEqual({ items: [], more: false, total: null });
  });
});

describe('parseStory', () => {
  it('lists every image of the album once, in order, from the cover folder only', () => {
    const page = storyPage({
      title: '2b &amp; 9s \u2013 Night',
      poster: `${FOLDER}1.webp`,
      images: [
        `${FOLDER}1.webp`,
        `${FOLDER}2.webp`,
        `${FOLDER}p=305/3.webp`,
        `${IMAGE_HOST}/upload/20260101/400/400000/9.webp`,
        'https://ads.example/4.jpg',
        `${FOLDER}2.webp`,
        `${FOLDER}10.jpg`,
      ],
    });
    expect(parseStory(page)).toEqual({ title: '2b & 9s \u00b7 Night', base: FOLDER, files: ['1.webp', '2.webp', '10.jpg'] });
  });

  it('takes the folder from the first image when there is no poster', () => {
    expect(parseStory(storyPage({ images: [`${FOLDER}5.png`, `${FOLDER}6.png`] }))).toEqual({ title: 'Album', base: FOLDER, files: ['5.png', '6.png'] });
  });

  it('returns null without a story or without images', () => {
    expect(parseStory('<html><body><img src="x"></body></html>')).toBeNull();
    expect(parseStory(storyPage({ images: ['https://ads.example/1.jpg'] }))).toBeNull();
  });
});

describe('parseVideo', () => {
  const stream = 'https://video16.videos-uploader.com/video/2026/1022/rLNoAx/video.m3u8';
  const poster = `${VIDEO_HOST}/video/2026/1022/rLNoAx/p=700/image-001.jpg`;

  it('reads the title, poster, and HLS stream', () => {
    expect(parseVideo(videoPage({ title: 'Cosplay 888', poster, stream }))).toEqual({ title: 'Cosplay 888', poster, stream });
  });

  it('falls back to the page title and drops posters from other hosts', () => {
    expect(parseVideo(videoPage({ title: 'Clip &amp; more', poster: 'https://ads.example/p.jpg', stream, h1: false }))).toEqual({ title: 'Clip & more', poster: null, stream });
  });

  it('returns null without a stream from the video host', () => {
    expect(parseVideo(videoPage({ poster }))).toBeNull();
    expect(parseVideo(videoPage({ poster, stream: 'https://ads.example/video.m3u8' }))).toBeNull();
    expect(parseVideo(videoPage({ poster, stream: 'http://video16.videos-uploader.com/video/2026/1022/rLNoAx/video.m3u8' }))).toBeNull();
  });
});
