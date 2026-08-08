# Fixture photo credits

Both photos were sourced via the [Openverse](https://openverse.org) API
(`https://api.openverse.org/v1/images/?q=<cat|dog>&license=cc0&extension=jpg`),
downloaded from their original Flickr source, then resized/re-encoded
(`ffmpeg -vf scale=480:-1 -q:v 6`) to fit the real-model spike test's
≤100KB-per-file budget. License was independently verified on each photo's
Flickr source page (not just the Openverse API response) before committing.

## cat.jpg

- Title: "Cat"
- Creator: Burnt Pineapple Productions
- Source: https://www.flickr.com/photos/51686021@N07/42700002412
- Original file: https://live.staticflickr.com/1731/42700002412_c4e96ba054_b.jpg
- License: CC0 1.0 Universal (Public Domain Dedication) — https://creativecommons.org/publicdomain/zero/1.0/

## dog.jpg

- Title: "Kasha At Rest"
- Creator: cogdogblog
- Source: https://www.flickr.com/photos/37996646802@N01/2061658540
- Original file: https://live.staticflickr.com/2226/2061658540_6c6cb6dc5d_b.jpg
- License: CC0 1.0 Universal (Public Domain Dedication) — https://creativecommons.org/publicdomain/zero/1.0/
