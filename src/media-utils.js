export function extractYouTubeVideoId(value) {
  const text = String(value || "");
  const match = text.match(
    /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/u
  );
  return match?.[1] || "";
}

export function parseMediaRequest(value) {
  const message = String(value || "").trim();

  const photoMatch = message.match(
    /^(?:please\s+)?(?:show|find|pull up|look up)\s+(?:me\s+)?(?:some\s+|an?\s+)?(?:photos?|pictures?|images?)\s+(?:of|for)\s+(.+)/iu
  );
  if (photoMatch) {
    return {
      type: "show_photo",
      query: photoMatch[1].trim()
    };
  }

  const directVideoId = extractYouTubeVideoId(message);
  if (directVideoId && /\b(?:play|show|open|pull up|watch)\b/iu.test(message)) {
    return {
      type: "play_youtube",
      videoId: directVideoId,
      query: ""
    };
  }

  const youtubeMatch = message.match(
    /^(?:please\s+)?(?:play|show|find|pull up|put on|watch)\s+(?:me\s+)?(.+?)(?:\s+on\s+youtube|\s+youtube\s+video)?[.!?]*$/iu
  );
  if (youtubeMatch && /\b(?:youtube|video|watch|play|put on)\b/iu.test(message)) {
    return {
      type: "play_youtube",
      videoId: "",
      query: youtubeMatch[1].replace(/\s+(?:on\s+youtube|youtube\s+video)$/iu, "").trim()
    };
  }

  return null;
}
