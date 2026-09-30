// clips-check — guards the immersive clip player (ShortsDeck) and everything
// that feeds it, so the 2026-09-13 audit fixes cannot quietly regress.
//
//   node scripts/clips-check.mjs              run the checks
//   node scripts/clips-check.mjs --self-test  prove every check FAILS on the
//                                             fault it exists to catch
//
// Assertions run on code with comments stripped: a comment explaining why
// something was removed must never satisfy a guard (that has happened here).
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');

const PATHS = {
  deck: 'src/screens/shorts/ShortsDeck.jsx',
  engage: 'src/components/clips/Engagement.jsx',
  ladder: 'src/screens/shorts/LadderPlayer.jsx',
  parts: 'src/screens/shorts/playerParts.jsx',
  clip: 'src/screens/viewer/ClipViewerScreen.jsx',
  feed: 'src/screens/shorts/useShortsFeed.js',
  webShorts: 'src/screens/shorts/ShortsScreen.jsx',
  nativeShorts: 'src/screens/shorts/native/NativeShortsScreen.jsx',
  postCard: 'src/components/PostCard.jsx',
  webPost: 'src/screens/home/PostDetailScreen.jsx',
  nativePost: 'src/screens/home/native/NativeHomeScreens.jsx',
  notif: 'src/hooks/useMergedNotifications.js',
};

// Founder, 2026-09-13: "why do the comments still go to a seperate page and not a
// sheet as i told you". Every road from a clip to its comments must end in the
// sheet over the playing clip, never the post page.
const COMMENT_ROUTE_CHECKS = [
  {
    name: 'a clip opened as /post redirects into the clip player (web and native)',
    run: (f) => [f.webPost, f.nativePost].every((s) => s.includes('isShortFormat(post.type)') && s.includes('<Navigate to={`/clip/${post.id}${location.search'))
      ? null : 'a /post link to a clip renders it as a regular post page again',
    breakIt: (f) => ({ ...f, nativePost: f.nativePost.replace('<Navigate to={`/clip/${post.id}${location.search', '<Navigate to={`/post/${post.id}${location.search') }),
  },
  {
    name: "the feed's comment button on a clip opens the sheet",
    run: (f) => (f.postCard.includes('onClick={goToComments}') && f.postCard.includes('/clip/${post.id}?comments=1'))
      ? null : 'the comment button on a clip goes somewhere other than the clip with its sheet up',
    breakIt: (f) => ({ ...f, postCard: f.postCard.replace('onClick={goToComments}', 'onClick={goToPost}') }),
  },
  {
    name: 'the player opens comments when a link asks for them, and loads like/save state',
    run: (f) => (f.clip.includes("params.get('comments') === '1'") && f.clip.includes('openCommentsId=')
      && f.deck.includes('setCommentsFor(current)') && f.deck.includes('engage.load(current)') && f.engage.includes('isPostLiked(item.id, uid)'))
      ? null : '?comments=1 or the liked-state load is no longer wired',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('engage.load(current)', 'void current') }),
  },
  {
    name: 'comment notifications carry the sheet flag',
    run: (f) => f.notif.includes("'?comments=1'") ? null : 'a comment notification no longer opens the sheet',
    breakIt: (f) => ({ ...f, notif: f.notif.replace("'?comments=1'", "''") }),
  },
];

const load = () => Object.fromEntries(Object.entries(PATHS).map(([k, p]) => [k, strip(read(p))]));

const CHECKS = [
  {
    name: '/clip/:postId renders the one shared player, not its own copy',
    run: (f) => (f.clip.includes("from '../shorts/ShortsDeck'") && f.clip.includes('useShortsFeed')
      && !f.clip.includes('<video') && !f.clip.includes('onTouchEnd')) ? null : 'ClipViewerScreen must render ShortsDeck via useShortsFeed and own no player',
    breakIt: (f) => ({ ...f, clip: `${f.clip}\n<video src="x" />` }),
  },
  {
    name: 'both /shorts shells use the shared loader',
    run: (f) => [f.webShorts, f.nativeShorts].every((s) => s.includes('useShortsFeed') && !s.includes('getDocs('))
      ? null : 'a shorts shell queries Firestore itself instead of useShortsFeed',
    breakIt: (f) => ({ ...f, nativeShorts: `${f.nativeShorts}\ngetDocs(q);` }),
  },
  {
    name: 'no "N / M" counter pill',
    run: (f) => /\{\s*index\s*\+\s*1\s*\}\s*\/\s*\{\s*feed\.length\s*\}/.test(f.deck) ? 'the counter pill is back' : null,
    breakIt: (f) => ({ ...f, deck: `${f.deck}\n<span>{index + 1} / {feed.length}</span>` }),
  },
  {
    name: 'no translucent control backgrounds (only marked scrims)',
    run: (f) => {
      for (const key of ['deck', 'engage', 'ladder', 'parts']) {
        if (f[key].includes('backdrop-blur')) return `${PATHS[key]} uses backdrop-blur`;
        const bad = f[key].split('\n').find((l) => /\bbg-(black|white)\/\d+/.test(l) && !l.includes('data-scrim'));
        if (bad) return `${PATHS[key]}: ${bad.trim().slice(0, 90)}`;
      }
      return null;
    },
    breakIt: (f) => ({ ...f, engage: `${f.engage}\n<div className="w-11 h-11 rounded-full bg-black/30" />` }),
  },
  {
    // Over the video the icons are bare (a disc over video is a smudge). The
    // desktop rail sits BESIDE the video on the page, where TikTok web uses a
    // solid 48px disc; that disc must stay SOLID and only ever render there.
    name: 'rail button: bare icon over video, solid disc only beside it',
    run: (f) => {
      const btn = f.engage.slice(f.engage.indexOf('export function EngageButton'));
      if (!btn.includes('filled') || /rounded-full[^"`]*bg-/.test(btn)) return 'EngageButton draws a class-based disc behind the icon';
      const disc = btn.match(/circle \? \{ background: '([^']+)' \}/);
      if (!disc || !/^#[0-9A-Fa-f]{6}$/.test(disc[1])) return 'the circle variant disc is missing or not a solid hex';
      if ((f.deck.match(/variant=\{railBeside \? 'circle' : 'bare'\}/g) || []).length !== 4) return 'a rail button renders the disc outside the beside-the-video rail';
      return null;
    },
    breakIt: (f) => ({ ...f, engage: f.engage.replace("{ background: '#24242F' }", "{ background: 'rgba(255,255,255,0.13)' }") }),
  },
  {
    name: 'the deck owns taps (so double-tap never pauses and resumes)',
    run: (f) => (f.deck.includes('tapToToggle: false') && f.ladder.includes('tapToToggle') && f.deck.includes('TAP_WAIT_MS'))
      ? null : 'players still toggle on their own click',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('tapToToggle: false', 'tapToToggle: true') }),
  },
  {
    name: 'insets are explicit (no safe-top / safe-bottom class clashes)',
    run: (f) => (!/\bsafe-(top|bottom)\b/.test(f.deck) && f.deck.includes('--vg-safe-b')) ? null : 'ShortsDeck relies on a safe-area class again',
    breakIt: (f) => ({ ...f, deck: `${f.deck}\n<div className="pb-8 safe-bottom" />` }),
  },
  {
    name: 'hold an edge for 2x, hold the middle for the menu',
    run: (f) => (/rel < EDGE \|\| rel > 1 - EDGE/.test(f.deck) && f.deck.includes('setMenuFor(item)')) ? null : 'hold zones are gone',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('rel < EDGE || rel > 1 - EDGE', 'rel < 0') }),
  },
  {
    name: 'menu actions do real work',
    run: (f) => (f.deck.includes('reportPost(currentUser.uid') && f.deck.includes('addNegativeAuthor(item.authorId)') && f.deck.includes('onRemove?.(item.id)'))
      ? null : 'a menu row no longer reaches its action',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('reportPost(currentUser.uid', 'console.log(currentUser.uid') }),
  },
  {
    name: 'authors are fetched once per author, never one after another',
    run: (f) => (f.feed.includes('Promise.all(ids.map') && !/for\s*\([^)]*\)\s*\{[^}]*await getUser/.test(f.feed))
      ? null : 'useShortsFeed fetches authors sequentially',
    breakIt: (f) => ({ ...f, feed: `${f.feed}\nfor (const p of posts) { await getUser(p.authorId); }` }),
  },
  {
    name: 'a deep link never plays a different clip',
    run: (f) => (f.clip.includes('missing ||') && f.feed.includes('getPost(startId)')) ? null : 'the missing-clip path is gone',
    breakIt: (f) => ({ ...f, clip: f.clip.replace('missing ||', '') }),
  },
  {
    name: 'double-tap hearts are drawn where the finger landed',
    run: (f) => f.deck.includes('likeAt(e.clientX - rect.left') ? null : 'hearts no longer follow the tap point',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('likeAt(e.clientX - rect.left', 'likeAt(0') }),
  },
  {
    // Measured on the device: a sideways drag across the video ended as a tap
    // and paused the clip.
    name: 'a pointer that travelled is never a tap',
    run: (f) => (f.deck.includes('moved.current = true') && f.deck.includes('!downOnControl.current && !moved.current'))
      ? null : 'a drag can still end as a tap and pause the clip',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('!downOnControl.current && !moved.current', '!downOnControl.current') }),
  },
  {
    // Measured on the device: a real long press fires no click, so the swallow
    // it armed ate the first tap inside the menu it opened.
    name: 'the click swallow resets before the overlay early-return',
    run: (f) => {
      const down = f.deck.slice(f.deck.indexOf('const onDown = (e) => {'));
      const reset = down.indexOf('swallowClick.current = false');
      const overlay = down.indexOf('inOverlay(e)) return');
      return reset > -1 && overlay > -1 && reset < overlay ? null : 'a long press can leave the swallow armed and eat the first tap in the menu';
    },
    breakIt: (f) => ({ ...f, deck: f.deck.replace('swallowClick.current = false;', '') }),
  },
];

// Founder, 2026-09-13, on desktop /shorts: "why are there arrows, when we set it
// up to scroll? ... the shorts should be centered like youtube does it ... there
// is also still a white ring around the avatar". Measured on vergr.app: the
// player sat in the 680px column pinned left, with ~1,100px empty beside it.
const DESKTOP_LAYOUT_CHECKS = [
  {
    name: 'no up/down arrow buttons on the player (it scrolls)',
    run: (f) => (/keyboard_arrow_(up|down)/.test(f.deck) || f.deck.includes('Previous clip')) ? 'arrow buttons are back on the player' : null,
    breakIt: (f) => ({ ...f, deck: `${f.deck}\n<Icon name="keyboard_arrow_up" />` }),
  },
  {
    name: 'the rail avatar has no ring',
    run: (f) => {
      const line = f.deck.split('\n').find((l) => l.includes('<UserAvatar src={author?.avatar}')) || '';
      return line && !/border-|ring-/.test(line) ? null : 'the rail avatar draws a border or ring again';
    },
    breakIt: (f) => ({ ...f, deck: f.deck.replace('<UserAvatar src={author?.avatar}', '<UserAvatar className="border-2 border-white" src={author?.avatar}') }),
  },
  {
    // TikTok (phone and web) draws no app title over the clip. Desktop controls
    // rest hidden and fade in on hover.
    name: 'no app title bar over the clip, desktop controls only on hover',
    run: (f) => (!f.deck.includes('>Shorts</h2>') && f.deck.split("railBeside ? 'opacity-0 group-hover:opacity-100").length - 1 === 2)
      ? null : 'the app title bar sits over the clip again',
    breakIt: (f) => ({ ...f, deck: `${f.deck}\n<h2 className="x">Shorts</h2>` }),
  },
  {
    name: 'desktop options menu is a dropdown under its button, not a sheet over the rail',
    run: (f) => (f.deck.includes('popover={railBeside}') && f.deck.includes('w-[264px] rounded-2xl')) ? null : 'the desktop menu is back to a bottom sheet over the video and rail',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('popover={railBeside}', 'popover={false}') }),
  },
  {
    name: 'desktop comments open as a panel beside the video, never a sheet over it',
    run: (f) => (f.deck.includes('variant="panel"') && f.deck.includes('createPortal(') && f.deck.includes('panelOpen && frameEl')
      && f.webShorts.includes('onSidePanel={setPanelOpen}') && f.clip.includes('onSidePanel={setPanelOpen}'))
      ? null : 'desktop comments are back to a bottom sheet over the video and rail',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('variant="panel"', 'variant="sheet"') }),
  },
  {
    name: 'desktop shorts is full width and centred, with the rail beside the video',
    run: (f) => (f.webShorts.includes("setContentAlign(isDesktop ? 'left' : 'center')")
      && f.deck.includes('{railBeside && !clear && railEl}') && f.deck.includes('ref={stageRef}')
      && f.webShorts.includes('SHORTS_RAIL_W') && f.clip.includes('SHORTS_RAIL_W'))
      ? null : 'desktop /shorts is back in the narrow column, or the rail sits over the video again',
    breakIt: (f) => ({ ...f, webShorts: f.webShorts.replace("setContentAlign(isDesktop ? 'left' : 'center')", "setContentAlign('center')") }),
  },
];

// Founder, 2026-09-13: "you have to view it on mobile" and "it needs to be on
// the level of tiktok". Measured against TikTok's mobile feed spec: 30-32px
// rail glyphs with 24px between items, 13px bold counts, "more" at the end of
// line two, a sound row under the caption and a sound disc under the rail.
const PHONE_CLIP_CHECKS = [
  {
    name: 'phone rail matches the TikTok spacing (32px glyphs, 18px gaps, 13px counts)',
    run: (f) => (f.deck.includes("'right-[4px] gap-[18px]'") && f.engage.includes("'w-[48px] h-[40px]'")
      && f.engage.includes('size={circle ? 24 : 32}') && f.engage.includes("'text-[13px] text-white'"))
      ? null : 'the phone rail is back to the cramped spacing',
    breakIt: (f) => ({ ...f, deck: f.deck.replace("'right-[4px] gap-[18px]'", "'right-1 gap-2.5'") }),
  },
  {
    name: 'phone rail draws the round comment bubble and curved share arrow',
    run: (f) => (f.deck.includes('glyph={railBeside ? undefined : COMMENT_GLYPH}') && f.deck.includes('glyph={railBeside ? undefined : SHARE_GLYPH}')
      && f.engage.includes('export const COMMENT_GLYPH') && f.engage.includes('export const SHARE_GLYPH'))
      ? null : 'the phone rail lost its TikTok-shaped comment or share glyph',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('glyph={railBeside ? undefined : COMMENT_GLYPH}', '') }),
  },
  {
    name: "the caption's more sits at the end of line two, not on a line of its own",
    run: (f) => (f.deck.includes('className="vg-cap-more') && f.deck.includes('.vg-cap-text::before') && !f.deck.includes("'line-clamp-2'"))
      ? null : '"more" is back on its own line under the caption',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('className="vg-cap-more', 'className="') }),
  },
  {
    name: 'portrait clips sit at the top of the screen in both players, never cropped',
    run: (f) => (f.parts.includes("tall ? 'center top'") && f.deck.includes('style={{ objectPosition }}')
      && f.ladder.includes('style={{ objectPosition }}') && f.ladder.includes('object-contain'))
      ? null : 'a player no longer pins portrait clips to the top',
    breakIt: (f) => ({ ...f, ladder: f.ladder.replace('style={{ objectPosition }}', '') }),
  },
  {
    name: 'the phone ⋯ lives under the rail, the desktop ⋯ in the top bar',
    run: (f) => (f.deck.includes('icon="more_horiz" label="More options" showCount={false}')
      && f.deck.includes('{railBeside && !isLiveSlide && current && <IconButton icon="more_horiz"'))
      ? null : 'the ⋯ button is missing from the phone rail or back in the phone top bar',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('icon="more_horiz" label="More options" showCount={false}', 'icon="x"') }),
  },
];

// Founder, 2026-09-13: "users should be able to upload sound separately like
// tiktok does, that way we can have the original sound – name".
const SOUND_CHECKS = [
  {
    name: 'every clip shows its sound row and disc, and both open the sound page',
    run: (f) => (f.deck.includes('soundKeyFor(current)') && f.deck.includes('<SoundMarquee text={soundLine}')
      && f.deck.includes('className="vg-spin') && f.sounds.includes("ORIGINAL_PREFIX = 'post_'")
      && f.router.includes('path="/sound/:soundId"'))
      ? null : 'the sound row, the disc or the /sound page route is gone',
    breakIt: (f) => ({ ...f, router: f.router.replace('path="/sound/:soundId"', 'path="/sounds"') }),
  },
  {
    name: 'an original sound writes nothing; a chosen sound rides the same post write',
    run: (f) => (f.fire.includes('if (soundId && sound) { postData.soundId = soundId; postData.sound = sound; }')
      && f.sounds.split('addDoc(').length - 1 === 1)
      ? null : 'sounds now write a document somewhere other than an upload',
    breakIt: (f) => ({ ...f, sounds: `${f.sounds}\naddDoc(x);` }),
  },
  {
    name: 'a chosen sound plays beside the video in both players, from our CDN only',
    run: (f) => (f.parts.includes('export function useLayeredSound')
      && f.deck.includes('useLayeredSound({ ref, active, muted, sound, volume:') && f.ladder.includes('useLayeredSound({ ref, active, muted, sound, volume:')
      && f.deck.includes('sound: layeredSoundFor(item)') && f.sounds.includes('startsWith(CDN_PREFIX)'))
      ? null : 'a player ignores the chosen sound, or plays audio from anywhere',
    breakIt: (f) => ({ ...f, ladder: f.ladder.replace('useLayeredSound({ ref, active, muted, sound, volume:', 'void ({') }),
  },
  {
    name: 'sound uploads are audio-only, capped and immutable on the server',
    run: (f) => (f.r2.includes("'sound'];") && f.r2.includes("kind === 'sound' && !contentType.startsWith('audio/')")
      && f.r2.includes("(kind === 'ambiance' || kind === 'sound') ? AMBIANCE_MAX_BYTES")
      && f.rules.includes('match /sounds/{soundId}') && f.rules.includes("url.matches('https://cdn[.]vergr[.]app/sound/.*')"))
      ? null : 'the server no longer restricts what a sound upload can be',
    breakIt: (f) => ({ ...f, r2: f.r2.replace("kind === 'sound' && !contentType.startsWith('audio/')", 'false') }),
  },
  {
    name: 'the clip flow offers a sound in the editor and on the post screen, and stores it',
    run: (f) => (f.flow.includes('...soundFieldsFor(sound, edits.originalVolume > 0)')
      && f.flow.split('soundChoice={soundChoice}').length - 1 >= 2
      && f.editor.includes('<SoundSheet') && f.editor.includes('useLayeredSound(')
      && f.clipForm.includes('<SoundSheet') && f.clipForm.includes('useLayeredSound('))
      ? null : 'the clip flow lost its sound picker or stopped storing the sound',
    breakIt: (f) => ({ ...f, flow: f.flow.replace('...soundFieldsFor(sound, edits.originalVolume > 0)', '') }),
  },
];

// Founder, 2026-09-13, on the create screens: "looking like it was done by a
// child". One post screen for web /create/short and the phone's short and clip
// screens, built to TikTok's publish screen and the house rules.
PATHS.clipForm = 'src/components/create/ClipPostForm.jsx';
const CREATE_SCREEN_CHECKS = [
  {
    name: 'one clip flow renders record, edit and post, on the web and the phone',
    run: (f) => (f.flow.includes('<ClipRecorder') && f.flow.includes('<ClipEditor') && f.flow.includes('<ClipPostForm'))
      ? null : 'the clip flow lost its recorder, editor or post step',
    breakIt: (f) => ({ ...f, flow: f.flow.replace('<ClipEditor', '<div') }),
  },
  {
    name: 'the flow screens are solid: no dashed boxes, blur, hairline borders or see-through tints',
    run: (f) => {
      for (const key of ['clipForm', 'editor', 'recorder', 'flow']) {
        const s = f[key];
        if (s.includes('border-dashed') || s.includes('backdrop-blur')) return `dashed box or blur in ${PATHS[key]}`;
        // A `border` class followed by a colour class. CSS `border-radius` and
        // `border:0` (a range thumb) are not hairlines and must not trip it.
        if (/\bborder(-[a-z]+)?-white\/|\bborder\b(?![-:])[^"'`]*\bborder-(?!radius)/.test(s)) return `a hairline border in ${PATHS[key]}`;
        if (/\b(bg|from|via|to)-[a-z0-9-]+\/(\d|\[)/.test(s)) return `a see-through tinted fill in ${PATHS[key]}`;
      }
      return (f.flow.includes('Select video') && f.clipForm.includes('aria-busy={!!busy}')) ? null : 'the upload page or the progress Post button is gone';
    },
    breakIt: (f) => ({ ...f, editor: `${f.editor}\n<div className="border-2 border-dashed" />` }),
  },
];

CHECKS.push(...COMMENT_ROUTE_CHECKS);
CHECKS.push(...DESKTOP_LAYOUT_CHECKS);
CHECKS.push(...PHONE_CLIP_CHECKS);
CHECKS.push(...SOUND_CHECKS);
// Founder, 2026-09-13: "did you make the improvements for broswer/desktop?" They
// had not been: Create Short was the phone column pinned to the sidebar with the
// rest of a 1536px screen empty, and the sound page the same. TikTok Studio's
// uploader is a drop zone, then details beside a phone preview.
PATHS.soundScreen = 'src/screens/shorts/SoundScreen.jsx';
PATHS.soundPicker = 'src/components/clips/SoundPicker.jsx';
const DESKTOP_CREATE_CHECKS = [
  {
    name: 'desktop clip flow: an editor page with tools and inspector, and details beside a live preview',
    run: (f) => (f.clipForm.includes("gridTemplateColumns: 'minmax(0,1fr) 340px'") && f.clipForm.includes('<EditedPreview')
      && f.editor.includes("gridTemplateColumns: '84px minmax(0,1fr) 360px'")
      && f.flow.split('wide={isDesktop}').length - 1 >= 3 && f.flow.includes("setContentAlign(isDesktop ? 'left' : 'center')"))
      ? null : 'the desktop clip flow is back to the phone column',
    breakIt: (f) => ({ ...f, flow: f.flow.split('wide={isDesktop}').join('') }),
  },
  {
    name: 'desktop clip flow takes a dropped video',
    run: (f) => (f.flow.includes('onDrop={') && f.flow.includes('onDropFile={acceptFile}'))
      ? null : 'drag and drop is gone from the desktop upload page',
    breakIt: (f) => ({ ...f, flow: f.flow.replace('onDropFile={acceptFile}', '') }),
  },
  {
    name: 'the sound page and the sound sheet are laid out for desktop',
    run: (f) => (f.soundScreen.includes("'grid grid-cols-5 gap-3'") && f.soundScreen.includes("max-w-[1040px]")
      && f.soundPicker.includes('lg:justify-center lg:items-center'))
      ? null : 'the sound page or sheet lost its desktop layout',
    breakIt: (f) => ({ ...f, soundScreen: f.soundScreen.replace("'grid grid-cols-5 gap-3'", "'grid grid-cols-3'") }),
  },
];
CHECKS.push(...CREATE_SCREEN_CHECKS);
CHECKS.push(...DESKTOP_CREATE_CHECKS);

// Founder, 2026-09-13: "where do i even go to create a clip becasue the create
// post compoennt still does the upload ... you do one screen but there is no way
// to get to that screen", and "build editing tools". One flow at /create/clip,
// reached from every Create entry, with trim cut into the file and text,
// stickers, speed and the sound mix drawn by the player.
const CLIP_FLOW_CHECKS = [
  {
    name: 'one clip route on web and phone, and /create/short redirects keeping ?sound=',
    run: (f) => (f.router.includes('<GuestRouteGate action="post clips"><CreateClipFlow /></GuestRouteGate>')
      && f.router.includes('path="/create/short" element={<CreateShortRedirect />}')
      && f.router.includes('<Navigate to={`/create/clip${search}`} replace />')
      && !f.router.includes('<NativeCreateClipPostScreen') && !f.router.includes('<CreateShortScreen'))
      ? null : '/create/clip is not the one flow on both builds, or /create/short no longer redirects into it',
    breakIt: (f) => ({ ...f, router: f.router.replace('<CreateClipFlow />', '<NativeCreateClipPostScreen />') }),
  },
  {
    name: 'every create entry leads to the clip flow',
    run: (f) => ([f.deck, f.webShorts, f.nativeShorts, f.soundScreen, f.nativeCreate].every((s) => !s.includes("navigate('/create/short") && !s.includes('`/create/short'))
      && [f.deck, f.webShorts, f.nativeShorts, f.nativeCreate].every((s) => s.includes("navigate('/create/clip')"))
      && f.soundScreen.includes('`/create/clip?sound='))
      ? null : 'an entry still points at the old short screen, or no longer reaches the clip flow',
    breakIt: (f) => ({ ...f, soundScreen: f.soundScreen.replace('`/create/clip?sound=', '`/create/short?sound=') }),
  },
  {
    name: 'the composer hands a video to the clip flow instead of uploading it',
    run: (f) => (f.composer.includes('setClipDraft(file') && f.composer.includes('if (video) { openClipFlow(video); return; }')
      && f.composer.split("branch('/create/clip')").length - 1 >= 3
      && !f.composer.includes('ac-cyan" onClick={() => videoRef.current?.click()}'))
      ? null : 'the composer uploads videos itself again, or Share Clip no longer opens the clip flow',
    breakIt: (f) => ({ ...f, composer: f.composer.replace('if (video) { openClipFlow(video); return; }', '') }),
  },
  {
    name: 'the editor has trim, text, stickers, speed, volume and cover; trim is cut into the file',
    run: (f) => (['trim', 'text', 'stickers', 'speed', 'volume', 'cover'].every((id) => f.editor.includes(`{ id: '${id}'`))
      && f.editor.includes('extractFrames(') && f.flow.includes('trimStart: startSec, trimEnd: endSec, mute')
      && f.flow.includes("type: 'clip'") && f.flow.includes('edits: editsForPost(') && f.fire.includes('postData.edits = edits'))
      ? null : 'an editor tool is gone, the trim is not cut, or the edits are not stored on the post',
    breakIt: (f) => ({ ...f, editor: f.editor.replace("{ id: 'speed'", "{ id: 'x'") }),
  },
  {
    name: 'both players draw the edits: overlays, base speed under hold-to-2x, the sound mix',
    run: (f) => (f.deck.includes('edits: playbackEdits(item)')
      && [f.deck, f.ladder].every((s) => s.includes('<EditOverlays overlays={overlays} rect={rect} />') && s.includes('(active ? speed : 1) * baseSpeed'))
      && f.parts.includes('scaleRef.current') && f.parts.includes('offsetRef.current'))
      ? null : 'a player ignores the creator\'s text, stickers, speed or sound mix',
    breakIt: (f) => ({ ...f, ladder: f.ladder.replace('<EditOverlays overlays={overlays} rect={rect} />', '') }),
  },
  {
    name: 'a recording carries its length and never far-seeks to find one',
    run: (f) => (f.recorder.includes('file._durationSec = secs') && f.flow.includes('Number(file._durationSec)')
      && f.flow.includes('fixWebmDuration(') && f.edits.includes('export async function fixWebmDuration')
      && ![f.recorder, f.flow, f.edits, f.editor].some((s) => /currentTime\s*=\s*(1e\d+|Number\.MAX|Infinity)/.test(s)))
      ? null : 'a recording lost its stamped length, or something far-seeks to measure a video',
    breakIt: (f) => ({ ...f, recorder: f.recorder.replace('file._durationSec = secs', '') }),
  },
  {
    name: 'overlays are placed on the picture, not the screen, by one renderer, and sanitised on read',
    run: (f) => (f.edits.includes('export function playbackEdits') && f.edits.includes('export function contentRect')
      && f.overlays.includes('overlayCss(o, rect)') && f.editor.includes('overlayCss(o, rect)'))
      ? null : 'overlay placement no longer shares one renderer, or playback trusts raw post fields',
    breakIt: (f) => ({ ...f, overlays: f.overlays.replace('overlayCss(o, rect)', '{}') }),
  },
];
CHECKS.push(...CLIP_FLOW_CHECKS);

// Founder, 2026-09-14, from screenshots of the phone: a white ring around avatars
// ("the only ring that should be visible is the live ring with the pill"), a
// camera where the create mark should be, "tauri.localhost" in the share sheet,
// a comment sheet with no emoji ("isnt even 10% as good as tiktok"), clips that
// showed as text-only posts, "post to feed" as other platforms do it, and an
// ambilight that ended in a hard line through the profile stats.
const SEPT14_CHECKS = [
  {
    name: 'a clip of type short renders its video in a feed card',
    run: (f) => f.postCard.includes("isShortFormat(contentPost?.type) || contentPost?.type === 'media'")
      ? null : 'the feed card lists clip types by hand again, and a short drops its video',
    breakIt: (f) => ({ ...f, postCard: f.postCard.replace("isShortFormat(contentPost?.type) || contentPost?.type === 'media'", "contentPost?.type === 'clip' || contentPost?.type === 'media'") }),
  },
  {
    name: 'Clips tabs take clips and shorts; Posts tabs and home feeds honour Also share to feed',
    run: (f) => {
      for (const key of ['profileOwn', 'profilePublic', 'profileNative']) {
        if (f[key].includes("p.type === 'clip'")) return `${PATHS[key]} filters Clips on 'clip' only`;
        if (!f[key].includes('sharesToFeed')) return `${PATHS[key]} ignores Also share to feed on its Posts tab`;
      }
      if ((f.profileNative.match(/isShortFormat\(p\.type\)/g) || []).length < 2) return 'a native profile view lost its Clips tab filter';
      if (!f.home.includes('followingPosts.filter(sharesToFeed)') || !f.home.includes('trendingPosts.filter(sharesToFeed)')
        || !f.home.includes('!sharesToFeed(it)')) return 'a home feed ignores Also share to feed';
      if (![f.explore, f.exploreNative].every((s) => s.includes("where('type', 'in', ['clip', 'short'])"))) return 'Explore clips miss shorts';
      return f.helpers.includes("post?.shareToFeed !== false") ? null : 'sharesToFeed no longer treats an unset field as shared';
    },
    breakIt: (f) => ({ ...f, profilePublic: f.profilePublic.replace('isShortFormat(p.type)', "p.type === 'clip'") }),
  },
  {
    name: 'the post screen offers Also share to feed and the post write stores it',
    run: (f) => (f.clipForm.includes('label="Also share to feed"') && f.clipForm.includes('role="switch"')
      && f.flow.includes('onShareToFeed={setShareToFeed}') && /editsForPost\([^\n]*\n\s*shareToFeed,/.test(f.flow)
      && f.fire.includes('postData.shareToFeed = shareToFeed'))
      ? null : 'the switch is gone, or the choice is not written with the post',
    breakIt: (f) => ({ ...f, flow: f.flow.replace(/(editsForPost\([^\n]*\n)\s*shareToFeed,/, '$1') }),
  },
  {
    name: 'your own clip can be removed from or added back to the feed after posting',
    run: (f) => (f.deck.includes('onToggleFeed={() => toggleFeed(menuFor)}') && f.deck.includes('setShareToFeed(item.id, next)')
      && f.postCard.includes('onClick={handleToggleFeed}') && f.raw.fire.includes('export const setShareToFeed'))
      ? null : 'the menu no longer changes Also share to feed',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('onToggleFeed={() => toggleFeed(menuFor)}', '') }),
  },
  {
    name: 'links that leave the app use vergr.app, never the app window origin',
    run: (f) => {
      for (const key of ['deck', 'postCard', 'msgDetail', 'groupInfo', 'groupInfoNative', 'eventShare', 'qr']) {
        if (f[key].includes('window.location.origin')) return `${PATHS[key]} builds a link from window.location.origin`;
      }
      if (f.profileOwn.includes('window.location.href')) return `${PATHS.profileOwn} shares its own window address`;
      return f.publicUrl.includes("PUBLIC_ORIGIN = 'https://vergr.app'") ? null : 'publicUrl no longer points at vergr.app';
    },
    breakIt: (f) => ({ ...f, deck: `${f.deck}\nconst u = window.location.origin;` }),
  },
  {
    name: 'the share page previews a clip with its cover image, never its video file',
    run: (f) => (f.raw.fnIndex.includes('if (post.thumbnailUrl) image = post.thumbnailUrl;') && f.raw.fnIndex.includes('firstMedia && !firstIsVideo'))
      ? null : 'the share page puts a video file in og:image again',
    breakIt: (f) => ({ ...f, raw: { ...f.raw, fnIndex: f.raw.fnIndex.replace('if (post.thumbnailUrl) image = post.thumbnailUrl;', '') } }),
  },
  {
    name: 'the create button is a plus in a rounded square',
    run: (f) => (f.deck.includes('icon="add_box" label="Create a clip"') && !f.deck.includes('icon="videocam"'))
      ? null : 'the create button is not add_box',
    breakIt: (f) => ({ ...f, deck: f.deck.replace('icon="add_box" label="Create a clip"', 'icon="videocam" label="Create a clip"') }),
  },
  {
    name: 'an avatar draws no ring except the live ring',
    run: (f) => {
      if (!f.avatar.includes('const finalRing = isLive ?') || f.avatar.includes('LIFT_RING')) return 'UserAvatar draws a ring that is not live';
      for (const key of ['profileOwn', 'profilePublic', 'profileNative']) {
        if (/vg-orbit|RING\.STATUS|RING\.ORBIT|0 0 20px var\(--vg-accent-dim\)/.test(f[key])) return `${PATHS[key]} draws an orbit, status or separator ring`;
      }
      return f.rankUnlocks.includes("name: 'Avatar orbit'") ? 'the avatar orbit is back on the ladder' : null;
    },
    breakIt: (f) => ({ ...f, avatar: `${f.avatar}\nconst LIFT_RING = 1;` }),
  },
  {
    name: 'the profile ambilight fades out with its block, never a fixed box with a black feather',
    run: (f) => {
      const counts = { profileOwn: 1, profilePublic: 1, profileNative: 2 };
      for (const [key, n] of Object.entries(counts)) {
        if ((f[key].match(/fade="bottom"/g) || []).length !== n) return `${PATHS[key]} is not using the fading ambilight`;
        if (f[key].includes('feather="#000000"')) return `${PATHS[key]} still paints a black feather`;
      }
      return f.ambilight.includes("fade === 'bottom'") ? null : 'Ambilight lost its fade mode';
    },
    breakIt: (f) => ({ ...f, profilePublic: f.profilePublic.replace('fade="bottom"', 'feather="#000000"') }),
  },
  {
    name: 'comments: emoji, photos and mentions, over an undimmed clip',
    run: (f) => (f.raw.commentSheet.includes('QUICK_EMOJI') && f.raw.commentSheet.includes('<EmojiPicker')
      && f.raw.commentSheet.includes('encodeMentions(') && f.raw.commentSheet.includes("'comment_media'")
      && !/bg-black\/\d+/.test(f.raw.commentSheet)
      && f.raw.fire.includes('data.mentionedUids = mentions') && f.raw.fnIndex.includes("type: 'mention'"))
      ? null : 'the comment sheet lost emoji, photos or mentions, or dims the clip again',
    breakIt: (f) => ({ ...f, raw: { ...f.raw, commentSheet: f.raw.commentSheet.replace('<EmojiPicker', '<div') } }),
  },
  {
    name: 'a mention suggestion costs no read',
    run: (f) => /searchUsers|getUserById|getUserByUsername|resolveChatUser\(/.test(f.raw.commentSheet)
      ? 'the comment sheet looks people up to suggest a mention' : null,
    breakIt: (f) => ({ ...f, raw: { ...f.raw, commentSheet: `${f.raw.commentSheet}\nsearchUsers('a');` } }),
  },
];
CHECKS.push(...SEPT14_CHECKS);

// Founder, 2026-09-14 (second pass): profile cards misaligned in a two-column
// grid ("instagram does not have this problem"), blank Top Clips thumbnails, no
// clips and an always-empty Trending on the home rail, a phone-browser prompt
// like X's, and the defects that had been listed instead of fixed: see-through
// header buttons, the music pill over post content, off-centre bottom nav labels
// and hairline dividers ("Why am I needing to tell you to fix things that should
// be obvious need to be fixed?").
const SEPT14B_CHECKS = [
  {
    name: 'profile Posts is one timeline and Clips / Media are grids, on all four views',
    run: (f) => {
      for (const key of ['profileOwn', 'profilePublic']) {
        if (f[key].includes('md:grid-cols-2 gap-3.5')) return `${PATHS[key]} lays posts out as a two-column grid again`;
        if (!f[key].includes('<ProfilePostList')) return `${PATHS[key]} no longer uses ProfilePostList`;
      }
      if (!f.profileNative.includes('<ProfilePostList tab={tab}')) return 'native profiles render Clips and Media as a feed column again';
      if (!f.grid.includes("if (tab === 'Clips') return <ClipGrid") || !f.grid.includes("if (tab === 'Media') return <MediaGrid")) return 'ProfilePostList no longer switches Clips and Media to grids';
      return (f.grid.includes('aspect-[9/16]') && f.grid.includes('aspect-square')) ? null : 'a clip or media tile lost its fixed shape';
    },
    breakIt: (f) => ({ ...f, profilePublic: f.profilePublic.replace('<ProfilePostList tab={activeTab}', '<div className="grid grid-cols-1 md:grid-cols-2 gap-3.5"') }),
  },
  {
    name: 'Top Clips in the profile rail shows the clip cover and opens the clip',
    run: (f) => {
      if (!f.grid.includes('navigate(`/clip/${c.id}`)') || !f.grid.includes('<Cover post={c} />')) return 'TopClipsList no longer shows the cover or opens the clip';
      for (const key of ['profileOwn', 'profilePublic']) {
        if (!f[key].includes('<TopClipsList clips={topClips}')) return `${PATHS[key]} draws Top Clips by hand again`;
        if (f[key].includes('linear-gradient(135deg,#1a0a2e,#0a1a3e)')) return `${PATHS[key]} still paints the empty gradient thumbnail`;
      }
      return null;
    },
    breakIt: (f) => ({ ...f, profileOwn: f.profileOwn.replace('<TopClipsList clips={topClips} loading={!loaded} />', "<div style={{ background: 'linear-gradient(135deg,#1a0a2e,#0a1a3e)' }} />") }),
  },
  {
    name: 'home rail: Trending reads the server list and the Clips card costs no read',
    run: (f) => {
      if (f.rail.includes("orderBy('postCount'")) return 'Trending orders by postCount, a field the server never writes';
      if (!f.rail.includes("doc(db, 'trending', 'hashtags')")) return 'Trending no longer reads trending/hashtags';
      if (!f.rail.includes("readFeedCache('shorts')") || !f.rail.includes('label="Clips"')) return 'the rail lost its Clips card';
      if (/collection\(db, 'posts'\)/.test(f.rail)) return 'the rail queries posts for clips, a read on every home load';
      return f.home.includes('<HomeFeedRail posts={forYouVisible} />') ? null : 'the home screen no longer hands the rail its loaded posts';
    },
    breakIt: (f) => ({ ...f, rail: f.rail.replace("doc(db, 'trending', 'hashtags')", "collection(db, 'hashtags')") }),
  },
  {
    name: 'phone browsers get the open-in-app sheet, not a small banner',
    run: (f) => (f.installBanner.includes('<OpenInAppSheet />') && f.openInApp.includes('intent://') && f.openInApp.includes('S.browser_fallback_url')
      && f.openInApp.includes('sessionStorage') && f.openInApp.includes('Open the VERGR app') && f.openInApp.includes('Not now'))
      ? null : 'the phone prompt is gone, or no longer opens the app with a fallback',
    breakIt: (f) => ({ ...f, installBanner: f.installBanner.replace('<OpenInAppSheet />', '<DesktopInstallBanner />') }),
  },
  {
    name: 'no see-through header buttons, headers or bottom nav',
    run: (f) => {
      for (const key of ['profileOwn', 'profilePublic', 'profileNative']) {
        if (f[key].includes("backdropFilter: 'blur(8px)'")) return `${PATHS[key]} has see-through banner buttons again`;
      }
      if (f.polish.includes('backdropFilter')) return 'the docked profile header is see-through again';
      if (/\.glass-header\s*\{[^}]*(backdrop-filter|rgba\()/.test(f.css)) return '.glass-header is see-through again';
      if (f.nav.includes('glass-header')) return 'the bottom nav is see-through again';
      return /function IconButton[\s\S]{0,500}background: SOLID/.test(f.deck) ? null : 'the clip top bar buttons lost their solid discs';
    },
    breakIt: (f) => ({ ...f, nav: f.nav.replace('safe-bottom lg:hidden', 'glass-header safe-bottom lg:hidden') }),
  },
  {
    name: 'every bottom nav tab, the avatar included, sits in the same icon box',
    run: (f) => ((f.nav.match(/NAV_ICON_BOX/g) || []).length >= 3 ? null : 'a bottom nav tab no longer uses the shared icon box, so its label drifts'),
    breakIt: (f) => ({ ...f, nav: f.nav.replace('<span className={NAV_ICON_BOX}>', '<span>') }),
  },
  {
    name: 'no hairline dividers in feed cards, profile tabs or the emoji picker',
    run: (f) => {
      if (f.postCard.includes('border-b border-white/[0.04] hover:bg-surface-1/30')) return 'feed cards draw a divider line again';
      if (/border-[tb] border-white\/\[0\.0[46]\]/.test(f.emoji)) return 'the emoji picker draws hairlines again';
      if (f.profileNative.includes('divide-y divide-white/[0.04]')) return 'native profile posts draw divider lines again';
      for (const key of ['profileNative', 'profilePublic']) {
        if (f[key].includes("border-b\" style={{ borderColor: '#1E1E2E' }}")) return `${PATHS[key]} draws a rule under its tabs or stats again`;
      }
      return null;
    },
    breakIt: (f) => ({ ...f, emoji: f.emoji.replace('bg-surface-1 flex flex-col', 'bg-surface-1 border-t border-white/[0.04] flex flex-col') }),
  },
  {
    name: 'the profile music player clears the bottom nav and never parks its label over posts',
    run: (f) => (f.audio.includes('!open && !scrolling') && !f.audio.includes('rgba(10,10,16,0.82)')
      && f.profilePublic.includes('bottom-[calc(72px+var(--vg-safe-b,0px))]') && f.profilePublic.includes("'pb-28'") && f.profileNative.includes("'pb-28'"))
      ? null : 'the music player sits over post content or behind the nav again',
    breakIt: (f) => ({ ...f, audio: f.audio.replace('!open && !scrolling', '!open') }),
  },
];
CHECKS.push(...SEPT14B_CHECKS);

// ─── 2026-09-14, third pass: the pixel audit in the founder's Chrome ───
// Every defect below was measured on vergr.app at 1540px and at 390px, after the
// second pass had been reported fixed. Founder: "do it pixel by pixel no bs".
const SEPT14C_CHECKS = [
  {
    name: 'the desktop shell and the stories row draw no divider lines',
    run: (f) => {
      if (/border-[xlr] border-white/.test(f.layout)) return 'the desktop layout draws a column divider again';
      if (f.sidebar.includes('border-r border-[#1E1E2E]') || f.sidebar.includes('h-px bg-white') || /border-[tb] border-white/.test(f.sidebar)) return 'the sidebar draws hairlines again';
      if (f.sidebar.includes("borderRight: '2px solid")) return 'the active sidebar item is outlined again';
      if (f.home.includes('px-4 py-3 border-b border-white/[0.04]')) return 'the stories row draws a divider again';
      if (f.home.includes('bg-white/[0.03] border border-white/[0.06]')) return 'the desktop composer box is see-through with an outline again';
      if (f.home.includes('rounded-full object-cover border border-white/[0.08]')) return 'the phone header avatar has a hairline ring again';
      return null;
    },
    breakIt: (f) => ({ ...f, sidebar: f.sidebar.replace('bg-[#0F0F1A] flex flex-col z-50', 'bg-[#0F0F1A] border-r border-[#1E1E2E] flex flex-col z-50') }),
  },
  {
    name: 'a feed glow sits beside its media, fades out, and never reaches the text above or below',
    run: (f) => ((/<Ambilight[^>]*bleedY=\{0\}[^>]*edgeFade/.test(f.postCard) && f.ambilight.includes("maskComposite: 'intersect'") && f.ambilight.includes("WebkitMaskComposite: 'source-in'"))
      ? null : 'the feed glow bleeds over the post text or ends in a hard edge again'),
    breakIt: (f) => ({ ...f, postCard: f.postCard.replace(' edgeFade', '') }),
  },
  {
    name: 'only the avatar overlaps the profile banner, the name starts below it',
    run: (f) => {
      for (const key of ['profileOwn', 'profilePublic', 'profileNative']) {
        if (f[key].includes('items-end gap-4 -mt-11')) return `${PATHS[key]} lifts the whole header row over the banner again, so the name sits on the art`;
        if (!f[key].includes('w-[88px] h-[88px] -mt-11')) return `${PATHS[key]} no longer lifts the avatar over the banner edge`;
      }
      return null;
    },
    breakIt: (f) => ({ ...f, profileOwn: f.profileOwn.replace('flex items-start gap-4 mb-3 pt-1', 'flex items-end gap-4 -mt-11 mb-3') }),
  },
  {
    name: 'profile header chips, tags and buttons are solid with no outline',
    run: (f) => {
      for (const key of ['profileOwn', 'profilePublic', 'profileNative']) {
        if (f[key].includes('vg-accent-chip') || f[key].includes('rgba(255,255,255,0.045)') || /rgba\(255,\s*255,\s*255,\s*0\.0\d+\)',\s*border:/.test(f[key])) {
          return `${PATHS[key]} has a see-through or outlined chip again`;
        }
      }
      return f.polish.includes('export const ACCENT_CHIP') ? null : 'the shared solid chip styles are gone';
    },
    breakIt: (f) => ({ ...f, profilePublic: f.profilePublic.replace('...SOLID_CHIP', "background: 'rgba(255,255,255,0.045)'") }),
  },
  {
    name: 'the docked profile header never shows as an empty bar on a desktop',
    run: (f) => (f.polish.includes("'lg:hidden'") ? null : 'the docked header spans the desktop window again, its name hidden under the sidebar'),
    breakIt: (f) => ({ ...f, polish: f.polish.replace("'lg:hidden'", "''") }),
  },
  {
    // Founder, 2026-09-14, on a one-column desktop profile: "does that sound
    // professional to you? i said we need a better solution not a quick fix".
    name: 'a wide-screen profile shows fixed-shape post tiles in a grid, never loose feed cards',
    run: (f) => {
      if (!f.grid.includes('variant="tile"') || !f.grid.includes("repeat(auto-fill, minmax(280px, 1fr))")) return 'the desktop profile no longer lays posts out as a tile grid';
      if (/grid-cols-[23][^"]*"[^>]*>\s*\{posts\.map\(\(p\) => <PostCard key=\{p\.id\} post=\{p\} onDeleted=\{onDeleted\} \/>/.test(f.grid)) return 'loose feed cards sit side by side again';
      // Every tile section has a fixed height, or a row stops lining up.
      for (const s of ["variant === 'tile'", 'h-[52px] shrink-0', 'aspect-[4/5]', 'h-[48px] shrink-0', 'line-clamp-2', 'h-[46px] shrink-0']) {
        if (!f.postCard.includes(s)) return `the post tile lost a fixed section (${s}), so its action row can drift`;
      }
      return f.tileStage.includes('object-contain') ? null : 'the tile stage crops media again';
    },
    breakIt: (f) => ({ ...f, postCard: f.postCard.replace('aspect-[4/5]', 'min-h-[200px]') }),
  },
  {
    name: 'rails never claim 0 or "No clips yet" while posts load, and home rail clips fill whole rows',
    run: (f) => {
      if (!f.grid.includes('loading = false')) return 'TopClipsList has no loading state';
      for (const key of ['profileOwn', 'profilePublic']) {
        if (!f[key].includes('<TopClipsList clips={topClips} loading={!loaded} />')) return `${PATHS[key]} shows "No clips yet" before its posts load`;
      }
      return f.rail.includes('(ranked.length % 3)') ? null : 'the home rail Clips grid can leave a hole in its last row again';
    },
    breakIt: (f) => ({ ...f, rail: f.rail.replace('(ranked.length % 3)', '0') }),
  },
  {
    name: 'coin chips are solid, clip top bar buttons are 40px, icons cannot shove labels while the font loads',
    run: (f) => {
      if (f.coinDisplay.includes('bg-surface-2/60') || f.topBar.includes('bg-surface-2/60') || f.coinQuick.includes('rgba(240,165,0,0.12)')) return 'a coin chip is see-through again';
      if (!/function IconButton[\s\S]{0,700}w-\[40px\] h-\[40px\]/.test(f.deck)) return 'the clip top bar buttons shrank below 40px again';
      if (!/\.material-symbols-outlined\s*\{[^}]*max-width:\s*1em/.test(read('index.html'))) return 'the icon class lost max-width: 1em, so a cold load shoves labels sideways again';
      return null;
    },
    breakIt: (f) => ({ ...f, coinDisplay: f.coinDisplay.replace('bg-surface-2 pl-2.5', 'bg-surface-2/60 pl-2.5') }),
  },
];
CHECKS.push(...SEPT14C_CHECKS);

Object.assign(PATHS, {
  layout: 'src/components/ResponsiveLayout.jsx',
  sidebar: 'src/components/DesktopSidebar.jsx',
  coinDisplay: 'src/components/CoinDisplay.jsx',
  coinQuick: 'src/components/wallet/CoinQuickBuy.jsx',
  topBar: 'src/components/TopBar.jsx',
  tileStage: 'src/components/profile/PostTileStage.jsx',
});

Object.assign(PATHS, {
  helpers: 'src/utils/helpers.js',
  profileOwn: 'src/screens/profile/ProfileScreen.jsx',
  profilePublic: 'src/screens/profile/PublicProfileScreen.jsx',
  profileNative: 'src/screens/profile/native/NativeProfileScreens.jsx',
  home: 'src/screens/home/HomeFeedScreen.jsx',
  explore: 'src/screens/explore/ExploreScreen.jsx',
  exploreNative: 'src/screens/explore/native/NativeExploreScreen.jsx',
  publicUrl: 'src/utils/publicUrl.js',
  msgDetail: 'src/layouts/MessagesMasterDetail.jsx',
  groupInfo: 'src/screens/messages/GroupInfoScreen.jsx',
  groupInfoNative: 'src/screens/messages/native/NativeGroupInfoScreen.jsx',
  eventShare: 'src/components/tournament/EventShareSheet.jsx',
  qr: 'src/components/verify/DesktopQRHandoff.jsx',
  fnIndex: 'functions/index.js',
  avatar: 'src/components/UserAvatar.jsx',
  rankUnlocks: 'src/utils/rankUnlocks.js',
  ambilight: 'src/components/effects/visual/Ambilight.jsx',
  commentSheet: 'src/components/CommentSheet.jsx',
});

Object.assign(PATHS, {
  sounds: 'src/utils/sounds.js',
  router: 'src/router/AppRouter.jsx',
  fire: 'src/firebase/firestore.js',
  r2: 'functions/r2.js',
  rules: 'firestore.rules',
  nativeCreate: 'src/screens/create/native/NativeCreateScreens.jsx',
  flow: 'src/screens/create/CreateClipFlow.jsx',
  editor: 'src/components/create/ClipEditor.jsx',
  recorder: 'src/components/create/ClipRecorder.jsx',
  edits: 'src/utils/clipEdits.js',
  overlays: 'src/components/clips/EditOverlays.jsx',
  composer: 'src/components/composer/CreateComposer.jsx',
});

Object.assign(PATHS, {
  grid: 'src/components/profile/ProfileGrid.jsx',
  rail: 'src/components/brand/HomeFeedRail.jsx',
  installBanner: 'src/components/InstallAppBanner.jsx',
  openInApp: 'src/components/OpenInAppSheet.jsx',
  css: 'src/index.css',
  nav: 'src/components/BottomNav.jsx',
  polish: 'src/components/profile/profilePolish.jsx',
  emoji: 'src/components/EmojiPicker.jsx',
  audio: 'src/components/effects/audio/ProfileAudio.jsx',
});

const files = load();
// ⚠ UNSTRIPPED copies for the checks that need them. `strip` reads the string
// "image/*" (and "*/*" in an Accept header) as the START of a block comment and
// deletes real code up to the next "*/". Measured 2026-09-14: it removed
// `<EmojiPicker` from CommentSheet, `setShareToFeed` from firestore.js and the
// og:image fix from functions/index.js, so correct code failed its guard. These
// checks look for exact code strings no comment contains.
files.raw = Object.fromEntries(['fire', 'fnIndex', 'commentSheet'].map((k) => [k, read(PATHS[k])]));

if (process.argv.includes('--self-test')) {
  let caught = 0;
  for (const c of CHECKS) {
    if (c.run(files)) { console.log(`SELF-TEST SKIPPED (already failing): ${c.name}`); continue; }
    const err = c.run(c.breakIt(files));
    if (err) caught += 1;
    else console.log(`SELF-TEST FAIL, did not catch its fault: ${c.name}`);
  }
  console.log(`clips-check self-test: ${caught}/${CHECKS.length} checks caught their fault`);
  process.exit(caught === CHECKS.length ? 0 : 1);
}

let failed = 0;
for (const c of CHECKS) {
  const err = c.run(files);
  if (err) { failed += 1; console.log(`FAIL ${c.name}\n     ${err}`); }
}
console.log(`clips-check: ${CHECKS.length - failed}/${CHECKS.length} passed`);
process.exit(failed ? 1 : 0);
