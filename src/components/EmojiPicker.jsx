import { useState, useRef, useMemo, useCallback, memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import ReactionEmoji, { preloadLottieRuntime } from './ReactionEmoji';

const SEARCH_INDEX = {
  happy:['😀','😃','😄','😁','😆','😊','🥰','😍','🤩','😎','🥳'],
  sad:['😢','😭','😞','😔','😟','🥺','😿','💔'],
  angry:['😠','😡','🤬','😤','👿'],
  laugh:['😂','🤣','😆','😅','😹'],
  lol:['😂','🤣','😆','💀'],
  love:['❤️','🥰','😍','😘','💕','💖','💗','💓','💞','💝','💘','🫶','💑','💏','😻','❤️‍🔥'],
  heart:['❤️','🧡','💛','💚','💙','🩵','💜','🩷','🤎','🖤','🩶','🤍','💔','❤️‍🔥','❤️‍🩹','💕','💖','💗','💓','💞','💝','💘','💟','❣️'],
  fire:['🔥','❤️‍🔥','☄️','💥'],
  cool:['😎','🆒','🧊','❄️','🥶'],
  think:['🤔','🧐','💭'],
  cry:['😢','😭','😿','🥲','😥'],
  sick:['🤒','🤕','🤮','🤢','😷','🥴'],
  skull:['💀','☠️','🏴‍☠️'],
  dead:['💀','☠️','⚰️'],
  ghost:['👻'],
  alien:['👽','👾','🛸'],
  robot:['🤖'],
  wave:['👋','🤚','🖐️','✋','🌊'],
  hi:['👋','🤚','✋','🙋'],
  bye:['👋','🤙'],
  hello:['👋','🤚','✋','🙋','😀'],
  thumbs:['👍','👎'],
  yes:['👍','✅','👌','🆗','✔️'],
  no:['👎','❌','🚫','⛔','🙅'],
  ok:['👌','👍','✅','🆗'],
  point:['👈','👉','👆','👇','☝️','🫵'],
  fist:['✊','👊','🤛','🤜'],
  punch:['👊','🤛','🤜','💥'],
  clap:['👏','🙌'],
  pray:['🙏','🤲'],
  please:['🙏','🥺','🤲'],
  muscle:['💪','🦾','🏋️'],
  flex:['💪','🦾','😤','🏋️'],
  strong:['💪','🦾','🏋️'],
  eye:['👀','👁️','🧿'],
  look:['👀','👁️','🔍','🔎'],
  dog:['🐶','🐕','🐩','🦮','🐕‍🦺','🐾'],
  cat:['🐱','🐈','🐈‍⬛','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
  monkey:['🐵','🙈','🙉','🙊','🐒'],
  bear:['🐻','🐻‍❄️','🐼','🧸'],
  money:['💰','💵','💴','💶','💷','💸','💳','🪙','🤑','💲','💹'],
  cash:['💰','💵','💴','💶','💷','💸','🤑'],
  rich:['💰','💎','🤑','💸','👑'],
  star:['⭐','🌟','✨','💫','🌠'],
  sparkle:['✨','💫','🌟','⭐'],
  sun:['☀️','🌞','🌅','🌄','😎'],
  moon:['🌙','🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘','🌚','🌛','🌜'],
  rain:['🌧️','☔','🌂','💧','🌦️'],
  snow:['❄️','☃️','⛄','🌨️','🏔️'],
  cold:['❄️','🥶','☃️','⛄','🧊'],
  hot:['🔥','🥵','☀️','🌶️','♨️'],
  rainbow:['🌈'],
  food:['🍔','🍕','🍟','🌭','🥪','🌮','🌯','🥙','🧆','🍗','🍖','🥩'],
  pizza:['🍕'],
  burger:['🍔'],
  sushi:['🍣','🍱','🥢'],
  cake:['🎂','🍰','🧁','🥧'],
  coffee:['☕','🫖','🍵'],
  tea:['🍵','🫖','☕'],
  beer:['🍺','🍻','🥂','🥃'],
  wine:['🍷','🍾'],
  drink:['🍺','🍻','🍷','🍸','🍹','🥂','🥃','🧃','🥤','🧋'],
  fruit:['🍎','🍏','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥝','🥭','🍍'],
  game:['🎮','🕹️','👾','🎲','🎯','🃏','♟️','🎰','🧩'],
  gaming:['🎮','🕹️','👾','🎲','🎯','🃏','♟️','🎰','🧩','🏆'],
  trophy:['🏆','🏅','🥇','🥈','🥉','🎖️'],
  win:['🏆','🥇','🏅','✅','💪','🎉'],
  lose:['😢','😭','💔','👎'],
  sword:['⚔️','🗡️'],
  shield:['🛡️'],
  gem:['💎','💍'],
  diamond:['💎','♦️'],
  controller:['🎮','🕹️'],
  rocket:['🚀'],
  car:['🚗','🚙','🏎️','🚕','🚓'],
  plane:['✈️','🛩️','🛫','🛬'],
  phone:['📱','📲','📞','☎️'],
  computer:['💻','🖥️','⌨️','🖱️'],
  music:['🎵','🎶','🎼','🎤','🎧','🎷','🎸','🎹','🎺','🎻','🥁'],
  camera:['📷','📸','📹','🎥','🎬'],
  book:['📖','📕','📗','📘','📙','📚','📓','📒'],
  flag:['🏁','🚩','🎌','🏳️','🏴','🏳️‍🌈','🏳️‍⚧️'],
  check:['✅','☑️','✔️','🆗'],
  cross:['❌','❎','✖️'],
  warning:['⚠️','🚨','🔔','❗'],
  question:['❓','❔','⁉️'],
  exclamation:['❗','❕','‼️'],
  hundred:['💯'],
  poop:['💩'],
  party:['🎉','🎊','🥳','🎈','🎆','🎇','🪅','🎁','🎀','🎗️'],
  celebrate:['🎉','🎊','🥳','🎈','🎆','🎇','🥂','🍾'],
  christmas:['🎄','🎅','🤶','🎁','⛄','❄️'],
  halloween:['🎃','👻','💀','🦇','🕷️','🕸️','🧙','🧛','🧟'],
  birthday:['🎂','🎁','🎈','🎉','🥳','🎊'],
  sleep:['😴','💤','🛌','😪'],
  tired:['😴','😪','🥱','💤'],
  run:['🏃','💨'],
  sports:['⚽','⚾','🏀','🏈','🎾','🏐','🏉','🥏','🏑','🏒','🥍','🏓','🏸'],
  ball:['⚽','⚾','🏀','🏈','🎾','🏐'],
  soccer:['⚽'],
  basketball:['🏀'],
  football:['🏈','⚽'],
  tennis:['🎾'],
  crown:['👑','🫅','🤴','👸'],
  king:['👑','🤴','🫅'],
  queen:['👸','👑','🫅'],
  magic:['✨','🪄','🔮','🧙'],
  ninja:['🥷'],
  pirate:['🏴‍☠️','☠️'],
  witch:['🧙','🧹','🪄'],
  zombie:['🧟'],
  vampire:['🧛'],
  fairy:['🧚'],
  mermaid:['🧜'],
  kiss:['💋','😘','😗','😚','😙','💏'],
  hug:['🤗','🫂','🫶'],
  ocean:['🌊','🐬','🐳','🦈','🏖️'],
  mountain:['🏔️','⛰️','🌋','🗻'],
  tree:['🌲','🌳','🌴','🎄','🎋'],
  flower:['🌸','🌺','🌻','🌹','🌷','🌼','💐','🥀'],
  rose:['🌹','🥀'],
  world:['🌍','🌎','🌏','🌐','🗺️'],
  lock:['🔒','🔓','🔐','🔑','🗝️'],
  key:['🔑','🗝️'],
  light:['💡','🔦','🕯️','🔆','✨'],
  dark:['🌑','🌚','🖤','⬛','🌃'],
  time:['⏰','⌛','⏳','🕐','⏱️'],
  clock:['⏰','🕐','⏱️','⏲️'],
  bomb:['💣','🧨','💥'],
  explode:['💥','💣','🧨','🎆'],
  scared:['😨','😰','😱','🫣','😧'],
  shock:['😱','😲','😮','😯','🤯'],
  worry:['😟','😰','😥','🫤','😕'],
  wink:['😉','😜'],
  tongue:['😛','😜','🤪','😝','👅'],
  nerd:['🤓','🧐'],
  devil:['😈','👿','👹'],
  angel:['😇','👼','😊'],
  baby:['👶','🍼','🧒'],
  family:['👪','👨‍👩‍👦','👨‍👩‍👧'],
  couple:['💑','💏','👫','👬','👭'],
  ring:['💍','💎'],
  wedding:['💒','💍','👰','🤵','💐'],
  paint:['🎨','🖌️','🖍️','🖼️'],
  art:['🎨','🖼️','🖌️'],
  tool:['🔧','🔩','⚙️','🛠️','🪛','🔨'],
  science:['🔬','🔭','🧪','🧫','🧬','⚗️','⚛️'],
  medicine:['💊','💉','🩹','🩺','🏥'],
  danger:['⚠️','☢️','☣️','🔞','⛔'],
  stop:['🛑','⛔','🚫','✋','❌'],
  gg:['🏆','👍','🤝','✅'],
  rip:['💀','⚰️','🪦','☠️'],
  bruh:['💀','😐','🗿'],
  sus:['🤨','👀','🧐'],
  vibe:['✨','💫','🎶','🎵','😎'],
  chill:['😌','🧊','❄️','🆒'],
  toxic:['☢️','☣️','🤮','🐍'],
  clutch:['🏆','💪','🔥','⚡'],
  cracked:['🔥','⚡','💪','🏆'],
  noob:['👶','🤡','😂'],
  goat:['🐐','🏆','👑'],
  based:['👑','💪','🔥','😎'],
  ratio:['📉','💀','😂'],
};

const EMOJI_DATA = {
  'Smileys': [
    '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
    '😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫',
    '🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪',
    '🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎',
    '🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰',
    '😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈',
    '👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼',
    '😽','🙀','😿','😾','🙈','🙉','🙊','💌','💘','💝','💖','💗','💓','💞','💕','💟',
    '❣️','💔','❤️‍🔥','❤️‍🩹','❤️','🩷','🧡','💛','💚','💙','🩵','💜','🤎','🖤','🩶','🤍',
    '💋','💯','💢','💥','💫','💦','💨','💬','💭','💤',
  ],
  'People': [
    '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟',
    '🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏',
    '🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻',
    '👃','🧠','👀','👁️','👅','👄','🫦','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩',
    '🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','🕵️','💂',
    '🥷','👷','🫅','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🤱','👼','🎅','🤶','🦸',
    '🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟','🧌','💆','💇','🚶','🧍','🧎','🏃','💃',
    '🕺','👯','🧖','🧗','🤸','⛹️','🏋️','🤼','🤽','🤾','🤺','⛷️','🏂','🏇','🏊',
    '🚣','🧘','🛀','🛌','👭','👫','👬','💏','💑','👪','🗣️','👤','👥','🫂',
  ],
  'Animals': [
    '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽',
    '🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉',
    '🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🕷️','🕸️','🦂','🐢',
    '🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋',
    '🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃',
    '🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🐈','🐈‍⬛','🐓','🦃',
    '🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️',
    '🦔','🐾','🐉','🐲','🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🌾','🌺',
    '🌻','🌹','🥀','🌷','🌼','🌸','💐','🍄','🌰',
  ],
  'Food': [
    '🍇','🍈','🍉','🍊','🍋','🍌','🍍','🥭','🍎','🍏','🍐','🍑','🍒','🍓','🫐',
    '🥝','🍅','🥥','🥑','🍆','🥔','🥕','🌽','🌶️','🥒','🥬','🥦','🧄','🧅','🥜',
    '🌰','🍞','🥐','🥖','🥨','🥯','🥞','🧇','🧀','🍖','🍗','🥩','🥓','🍔','🍟',
    '🍕','🌭','🥪','🌮','🌯','🥙','🧆','🥚','🍳','🥘','🍲','🥣','🥗','🍿','🧈',
    '🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🍡',
    '🥟','🥠','🥡','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭',
    '🍮','🍯','🍼','🥛','☕','🫖','🍵','🍶','🍾','🍷','🍸','🍹','🍺','🍻','🥂',
    '🥃','🥤','🧋','🧃','🧉','🧊','🥢','🍽️','🍴','🥄','🔪',
  ],
  'Gaming': [
    '🎮','🕹️','🏆','⚔️','🎯','🛡️','💎','🪙','🎲','🃏','👾','🤖','🚀','💣','⚡',
    '🔥','❄️','🌟','✨','🎪','🏅','🥇','🥈','🥉','🎖️','⚽','⚾','🥎','🏀','🏐',
    '🏈','🏉','🎾','🥏','🎳','🏏','🏑','🏒','🥍','🏓','🏸','🥊','🥋','🥅','⛳',
    '⛸️','🎣','🤿','🎽','🎿','🛷','🥌','🎱','🔮','🪄','🎰','🧩','🧸','🪩','♠️',
    '♥️','♦️','♣️','♟️','🀄','🎴','🎭','🎨','🎬','🎤','🎧',
  ],
  'Travel': [
    '🌍','🌎','🌏','🗺️','🧭','🏔️','⛰️','🌋','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️',
    '🏠','🏡','🏢','🏥','🏦','🏨','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽',
    '⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇',
    '🌉','🎠','🛝','🎡','🎢','🚂','🚄','🚅','🚆','🚇','🚌','🚑','🚒','🚓','🚕',
    '🚗','🚙','🛻','🚚','🏎️','🏍️','🛵','🚲','🛴','🛹','🚨','🚥','⛵','🚤','🛳️',
    '🚢','✈️','🛩️','🛫','🛬','💺','🚁','🛰️','🚀','🛸','🌑','🌕','🌙','☀️','🌞',
    '🪐','⭐','🌟','🌠','🌌','☁️','⛅','🌧️','🌨️','🌩️','🌪️','🌈','☔','⚡','❄️',
    '☃️','⛄','🔥','💧','🌊',
  ],
  'Objects': [
    '👓','🕶️','🥽','👔','👕','👖','🧣','🧤','🧥','👗','👙','👚','👛','👜','👝',
    '🎒','👞','👟','🥾','🥿','👠','👡','👢','👑','👒','🎩','🎓','🧢','💄','💍',
    '💎','🔇','🔈','🔉','🔊','📢','📣','🔔','🔕','🎼','🎵','🎶','🎙️','🎚️','🎛️',
    '🎤','🎧','📻','🎷','🎸','🎹','🎺','🎻','🥁','📱','📲','☎️','📞','💻','🖥️',
    '🖨️','⌨️','🖱️','💽','💾','💿','📀','🎥','📽️','🎬','📺','📷','📸','📹','🔍',
    '🔎','🕯️','💡','🔦','🏮','📔','📕','📖','📗','📘','📙','📚','📓','📒','📃',
    '📜','📄','📰','📑','🔖','🏷️','💰','🪙','💴','💵','💶','💷','💸','💳','✉️',
    '📧','📨','📩','📤','📥','📦','📫','📮','✏️','✒️','🖋️','🖊️','🖌️','🖍️','📝',
    '💼','📁','📂','📅','📆','📇','📈','📉','📊','📋','📌','📍','📎','📏','📐',
    '✂️','🗑️','🔒','🔓','🔑','🗝️','🔨','⛏️','🛠️','🗡️','⚔️','💣','🏹','🛡️','🔧',
    '🔩','⚙️','⚖️','🔗','⛓️','🧰','🧲','⚗️','🧪','🧫','🧬','🔬','🔭','📡','💉',
    '💊','🩹','🩺','🚪','🛏️','🛋️','🪑','🚽','🚿','🛁','🧴','🧷','🧹','🧺','🧻',
    '🧼','🧽','🧯','🛒','🗿',
  ],
  'Symbols': [
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❣️','💕','💞','💓',
    '💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️',
    '🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️',
    '☢️','☣️','📴','📳','✴️','🆚','💮','㊙️','㊗️','🅰️','🅱️','🆎','🆑','🅾️','🆘',
    '❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵',
    '🚭','❗','❕','❓','❔','‼️','⁉️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','❇️',
    '✳️','❎','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🛗','🈳','🛂','🛃','🛄',
    '🛅','🚹','🚺','🚼','⚧️','🚻','🚮','🎦','📶','🔣','ℹ️','🔤','🔡','🔠','🆖',
    '🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣',
    '9️⃣','🔟','🔢','#️⃣','*️⃣','▶️','⏸️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','◀️','🔼',
    '🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️',
    '🔀','🔁','🔂','🔄','🔃','➕','➖','➗','✖️','🟰','♾️','💲','💱','™️','©️',
    '®️','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻',
    '🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','🟥','🟧','🟨','🟩','🟦',
    '🟪','⬛','⬜','🟫',
  ],
  'Flags': [
    '🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️',
    '🇦🇫','🇦🇱','🇩🇿','🇦🇩','🇦🇴','🇦🇬','🇦🇷','🇦🇲','🇦🇺','🇦🇹','🇦🇿','🇧🇸',
    '🇧🇭','🇧🇩','🇧🇧','🇧🇾','🇧🇪','🇧🇿','🇧🇯','🇧🇹','🇧🇴','🇧🇦','🇧🇼','🇧🇷',
    '🇧🇳','🇧🇬','🇧🇫','🇧🇮','🇰🇭','🇨🇲','🇨🇦','🇨🇱','🇨🇳','🇨🇴','🇨🇷','🇭🇷',
    '🇨🇺','🇨🇾','🇨🇿','🇩🇰','🇩🇴','🇪🇨','🇪🇬','🇸🇻','🇪🇪','🇪🇹','🇫🇯','🇫🇮',
    '🇫🇷','🇬🇦','🇬🇲','🇬🇪','🇩🇪','🇬🇭','🇬🇷','🇬🇩','🇬🇹','🇬🇾','🇭🇹','🇭🇳',
    '🇭🇰','🇭🇺','🇮🇸','🇮🇳','🇮🇩','🇮🇷','🇮🇶','🇮🇪','🇮🇱','🇮🇹','🇯🇲','🇯🇵',
    '🇯🇴','🇰🇿','🇰🇪','🇰🇼','🇰🇬','🇱🇻','🇱🇧','🇱🇾','🇱🇹','🇱🇺','🇲🇬','🇲🇾',
    '🇲🇻','🇲🇱','🇲🇹','🇲🇽','🇲🇩','🇲🇨','🇲🇳','🇲🇪','🇲🇦','🇲🇿','🇲🇲','🇳🇦',
    '🇳🇵','🇳🇱','🇳🇿','🇳🇮','🇳🇬','🇰🇵','🇳🇴','🇴🇲','🇵🇰','🇵🇸','🇵🇦','🇵🇾',
    '🇵🇪','🇵🇭','🇵🇱','🇵🇹','🇵🇷','🇶🇦','🇷🇴','🇷🇺','🇷🇼','🇸🇦','🇸🇳','🇷🇸',
    '🇸🇬','🇸🇰','🇸🇮','🇸🇴','🇿🇦','🇰🇷','🇪🇸','🇱🇰','🇸🇩','🇸🇪','🇨🇭','🇸🇾',
    '🇹🇼','🇹🇿','🇹🇭','🇹🇳','🇹🇷','🇺🇬','🇺🇦','🇦🇪','🇬🇧','🇺🇸','🇺🇾','🇺🇿',
    '🇻🇪','🇻🇳','🇾🇪','🇿🇲','🇿🇼',
  ],
};

const CATEGORY_ICONS = {
  'Smileys': 'sentiment_satisfied', 'People': 'person', 'Animals': 'pets',
  'Food': 'restaurant', 'Gaming': 'sports_esports', 'Travel': 'flight',
  'Objects': 'lightbulb', 'Symbols': 'tag', 'Flags': 'flag',
};

const RECENT_KEY = 'vergr_recent_emojis';
const MAX_RECENT = 32;

function getRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } }
function addRecent(emoji) {
  try {
    let r = getRecent().filter(x => x !== emoji);
    r.unshift(emoji);
    localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, MAX_RECENT)));
  } catch {}
}

// ── Skin tones (Telegram-style: long-press a hand/person emoji to pick) ──
// Only single-person/hand emojis that take a plain Fitzpatrick modifier (no
// ZWJ sequences — those need per-member modifiers and don't round-trip).
const TONE_KEY = 'vergr_emoji_tones';
const SKIN_TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const TONEABLE = new Set([
  '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟',
  '🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏',
  '🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦵','🦶','👂','🦻','👃','👶',
  '🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁',
  '🙋','🧏','🙇','🤦','🤷','👮','🕵️','💂','🥷','👷','🫅','🤴','👸','👳','👲','🧕',
  '🤵','👰','🤰','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧚','🧛','🧜','🧝','💆','💇',
  '🚶','🧍','🧎','🏃','💃','🕺','🧖','🧗','🤸','🏋️','🤺','🏇','🏊','🚣','🧘','🛀','🛌',
]);
function getTones() { try { return JSON.parse(localStorage.getItem(TONE_KEY)) || {}; } catch { return {}; } }
function saveTone(base, tone) {
  try {
    const t = getTones();
    if (tone) t[base] = tone; else delete t[base];
    localStorage.setItem(TONE_KEY, JSON.stringify(t));
  } catch {}
}
// The variation selector (FE0F) can't precede a skin-tone modifier — strip it.
function toneVariant(base, tone) { return tone ? base.replace(/️/g, '') + tone : base; }

// memo()'d so a parent re-rendering on every keystroke (e.g. a composer
// textarea next to an open picker) doesn't force this whole grid — up to a
// few hundred emoji buttons — to re-render each time. Only skips a re-render
// when the caller passes stable onSelect/onClose (useCallback); callers that
// pass fresh inline arrows each render are unaffected (same as before).
// Search-row quick filters (Telegram puts these inline with search): tapping
// one runs that keyword through the normal search index.
const SEARCH_CHIPS = [
  ['❤️', 'heart'], ['👍', 'thumbs'], ['😂', 'laugh'], ['😢', 'cry'], ['🔥', 'fire'],
];

// Cell size drives the layout. The grid is sized from the CONTAINER (auto-fill
// + a real gap), never from viewport breakpoints: this picker renders both as a
// full-width mobile sheet AND as a ~410px reaction popover on desktop, so
// `lg:grid-cols-10 xl:grid-cols-12` crammed 12 columns into that narrow panel
// with zero gap — emojis packed edge to edge on desktop while mobile looked
// fine. Container-relative sizing gives identical spacing at any width.
const MIN_CELL = 44; // px — 31px emoji + breathing room
const CELL_GAP = 4;  // px — matches gap-1

function EmojiPicker({ onSelect, onClose, height = 300, emojiSize = 31 }) {
  const [search, setSearch] = useState('');
  const searchRef = useRef(null);
  const scrollRef = useRef(null);
  const sectionRefs = useRef({});
  const scrollTickRef = useRef(false);
  // State (not a one-shot memo) so recents stay fresh within a session where
  // the picker stays mounted across selections (composer usage).
  const [recent, setRecent] = useState(getRecent);
  const [active, setActive] = useState(() => (recent.length > 0 ? '__recent__' : 'Smileys'));
  // { base, left, top } while the skin-tone popover is open.
  const [tonePicker, setTonePicker] = useState(null);
  const [tones, setTones] = useState(getTones);
  const tonePressTimer = useRef(null);
  const toneLongPressed = useRef(false);

  useEffect(() => { preloadLottieRuntime(); }, []);
  useEffect(() => () => clearTimeout(tonePressTimer.current), []);

  const handleSelect = useCallback((emoji) => { addRecent(emoji); setRecent(getRecent()); onSelect(emoji); }, [onSelect]);

  const openTonePicker = (base, el) => {
    const r = el.getBoundingClientRect();
    // 6 variants at 34px each + padding ≈ 216px wide; clamp to the viewport.
    const w = 216;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    setTonePicker({ base, left, top: Math.max(8, r.top - 46) });
  };
  const startTonePress = (emoji, el) => {
    if (!TONEABLE.has(emoji)) return;
    toneLongPressed.current = false;
    clearTimeout(tonePressTimer.current);
    tonePressTimer.current = setTimeout(() => { toneLongPressed.current = true; openTonePicker(emoji, el); }, 420);
  };
  const endTonePress = () => clearTimeout(tonePressTimer.current);
  const pickTone = (tone) => {
    if (!tonePicker) return;
    saveTone(tonePicker.base, tone);
    setTones(getTones());
    setTonePicker(null);
    handleSelect(toneVariant(tonePicker.base, tone));
  };

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase().trim();
    const matches = new Set();
    for (const [keyword, emojis] of Object.entries(SEARCH_INDEX)) {
      if (keyword.includes(q) || q.includes(keyword)) emojis.forEach(e => matches.add(e));
    }
    for (const [cat, emojis] of Object.entries(EMOJI_DATA)) {
      if (cat.toLowerCase().includes(q)) emojis.forEach(e => matches.add(e));
    }
    return [...matches];
  }, [search]);

  // ONE continuous scroll through every category with sticky section headers
  // (Telegram model); the tabs jump-scroll and highlight via scrollspy.
  const sections = useMemo(() => {
    const s = [];
    if (recent.length > 0) s.push(['__recent__', recent]);
    for (const [cat, list] of Object.entries(EMOJI_DATA)) s.push([cat, list]);
    return s;
  }, [recent]);

  // Container-relative grid. auto-fill + gap means the SAME picker spaces its
  // cells identically whether it's a full-width mobile sheet or a narrow
  // desktop reaction popover.
  const gridStyle = { gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_CELL}px, 1fr))` };

  // Measured from the scroll container (see MIN_CELL note). Used for the
  // entrance stagger and for the content-visibility height estimate — a
  // viewport-derived guess made both wrong inside a narrow popover.
  const [cols, setCols] = useState(8);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth - 8; // px-1 padding either side
      if (w > 0) setCols(Math.max(4, Math.floor(w / (MIN_CELL + CELL_GAP))));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scrollspy: cheapest correct thing is an rAF-throttled offsetTop scan
  // (sections are static heights; no observers needed).
  const onScroll = () => {
    if (search || scrollTickRef.current) return;
    scrollTickRef.current = true;
    requestAnimationFrame(() => {
      scrollTickRef.current = false;
      const box = scrollRef.current;
      if (!box) return;
      const top = box.scrollTop + 40;
      let current = sections[0]?.[0];
      for (const [name] of sections) {
        const el = sectionRefs.current[name];
        if (el && el.offsetTop <= top) current = name;
        else break;
      }
      if (current) setActive(current);
    });
  };

  const jumpTo = (name) => {
    if (search) { setSearch(''); }
    setActive(name);
    // Defer one frame when leaving search so the sections exist again.
    requestAnimationFrame(() => {
      const el = sectionRefs.current[name];
      const box = scrollRef.current;
      if (el && box) box.scrollTop = el.offsetTop;
    });
  };

  const tabClass = (name) => `flex-1 py-1.5 flex items-center justify-center transition-all relative ${
    !search && active === name ? 'text-brand-violet-light' : 'text-text-muted hover:text-text-secondary'
  }`;

  const renderCell = (emoji, i, sectionIndex) => {
    // Slot-machine entrance on open: first ~5 rows of the FIRST section roll
    // in from below, later rows from a steeper angle. Jump-scrolls and search
    // don't replay (Telegram behaviour).
    const row = Math.floor(i / cols);
    const animate = sectionIndex === 0 && !search && row < 5;
    // Grid shows the saved skin-tone variant (Telegram behaviour); long-press
    // or right-click a toneable emoji opens the tone popover.
    const display = tones[emoji] ? toneVariant(emoji, tones[emoji]) : emoji;
    return (
      <button key={`${emoji}-${i}`}
        onClick={() => { if (toneLongPressed.current) { toneLongPressed.current = false; return; } handleSelect(display); }}
        onPointerDown={(e) => startTonePress(emoji, e.currentTarget)}
        onPointerUp={endTonePress}
        onPointerLeave={endTonePress}
        onContextMenu={(e) => { if (TONEABLE.has(emoji)) { e.preventDefault(); toneLongPressed.current = true; openTonePicker(emoji, e.currentTarget); } }}
        className={`flex items-center justify-center w-full aspect-square rounded-md hover:bg-surface-2 active:scale-75 transition-transform select-none ${animate ? 'emoji-in' : ''}`}
        style={animate ? { '--eid': `${Math.min(row * 0.028 + (i % cols) * 0.008, 0.4)}s`, '--eiy': `${14 + row * 6}px` } : undefined}>
        {/* hoverToPlay, NOT playOnceInView. play-on-scroll-in swapped each glyph
            for its Lottie one tile at a time as you scrolled, and because the
            two render at slightly different optical sizes the whole grid
            visibly churned and resized — it read as a broken picker rather than
            a lively one. The glyph is the stable, instant baseline; the Noto
            animation plays on deliberate hover only (no-op on touch). */}
        <ReactionEmoji emoji={display} size={emojiSize} hoverToPlay />
      </button>
    );
  };

  return (
    // No hairlines anywhere in the picker (founder, 2026-09-14). Rows are
    // separated by space and solid values, never 1px strokes.
    <div className="bg-surface-1 flex flex-col" style={{ height }}>
      {/* Category rail ABOVE search (Telegram puts its sets row on top). */}
      <div className="flex items-center px-0.5 shrink-0">
        {recent.length > 0 && (
          <button onClick={() => jumpTo('__recent__')} className={tabClass('__recent__')}>
            <Icon name="schedule" size={16} />
            {!search && active === '__recent__' && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-brand-violet rounded-full" />}
          </button>
        )}
        {Object.entries(CATEGORY_ICONS).map(([cat, icon]) => (
          <button key={cat} onClick={() => jumpTo(cat)} className={tabClass(cat)}>
            <Icon name={icon} size={16} />
            {!search && active === cat && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-brand-violet rounded-full" />}
          </button>
        ))}
      </div>

      <div className="px-2 pt-2 pb-1 flex items-center gap-1.5">
        <div className="flex-1 flex items-center bg-surface-2 rounded-lg px-2.5 gap-2">
          <Icon name="search" size={16} className="text-text-muted shrink-0" />
          <input ref={searchRef} type="text" placeholder="Search emoji..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent py-1.5 text-xs text-white outline-none placeholder:text-text-muted/60" />
          {search ? (
            <button onClick={() => { setSearch(''); searchRef.current?.focus(); }} className="text-text-muted hover:text-white">
              <Icon name="close" size={14} />
            </button>
          ) : (
            <span className="flex items-center gap-0.5 shrink-0">
              {SEARCH_CHIPS.map(([glyph, term]) => (
                <button key={term} onClick={() => setSearch(term)} title={term}
                  className="w-6 h-6 rounded flex items-center justify-center text-[15px] leading-none opacity-60 hover:opacity-100 hover:bg-surface-3 transition-all">
                  <span role="img" style={{ color: 'initial' }}>{glyph}</span>
                </button>
              ))}
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            title="Close emoji picker"
            className="shrink-0 w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-3 transition-colors"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto no-scrollbar px-1 pb-1 relative">
        {search ? (
          <>
            <p className="text-[9px] font-bold text-text-muted uppercase tracking-widest px-2 py-1">{`Results for "${search}"`}</p>
            <div className="grid gap-1" style={gridStyle}>
              {(searchResults || []).map((emoji, i) => renderCell(emoji, i, -1))}
            </div>
            {(searchResults || []).length === 0 && (
              <div className="py-6 text-center">
                <p className="text-text-muted text-xs">{`No emojis found for "${search}"`}</p>
              </div>
            )}
          </>
        ) : sections.map(([name, list], si) => (
          <div key={name} ref={(el) => { sectionRefs.current[name] = el; }}
            // content-visibility virtualizes offscreen sections for free
            // (~1,700 cells total would otherwise all lay out on open).
            style={si > 0 ? { contentVisibility: 'auto', containIntrinsicSize: `auto ${Math.ceil(list.length / cols) * (MIN_CELL + CELL_GAP) + 26}px` } : undefined}>
            <p className="sticky top-0 z-10 bg-surface-1 text-[9px] font-bold text-text-muted uppercase tracking-widest px-2 py-1">
              {name === '__recent__' ? 'Recently Used' : name}
            </p>
            <div className="grid gap-1" style={gridStyle}>
              {list.map((emoji, i) => renderCell(emoji, i, si))}
            </div>
          </div>
        ))}
      </div>

      {/* Skin-tone popover (long-press / right-click a hand or person emoji).
          Portalled so the picker's own scroll container can't clip it. */}
      {tonePicker && createPortal(
        <div className="fixed inset-0 z-[10010]" onPointerDown={() => setTonePicker(null)}>
          <div
            className="absolute flex items-center gap-0.5 p-1.5 bg-surface-2 rounded-full shadow-2xl"
            style={{ left: tonePicker.left, top: tonePicker.top }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {SKIN_TONES.map((tone) => {
              const variant = toneVariant(tonePicker.base, tone);
              const selected = (tones[tonePicker.base] || '') === tone;
              return (
                <button key={tone || 'default'} onClick={() => pickTone(tone)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-[22px] leading-none transition-colors ${
                    selected ? 'bg-[#3B2A63]' : 'hover:bg-surface-3'
                  }`}>
                  <span role="img" style={{ color: 'initial' }}>{variant}</span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default memo(EmojiPicker);