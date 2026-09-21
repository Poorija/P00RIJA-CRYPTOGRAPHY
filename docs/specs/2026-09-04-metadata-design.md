# Metadata: see it, edit it, remove it

## Why

A photograph taken on a phone carries where it was taken, on what, when, and
often the serial number of the camera. An app that encrypts the photograph and
then sends those coordinates alongside it has protected the wrong thing.

Nothing in P00RIJA reads or removes metadata today. This adds it in two places:
a tab of its own, where a file can be inspected and edited field by field, and
a hook in Secure Chat, so a file sent to somebody carries nothing it was not
meant to carry.

## Scope

Images, video and audio - the formats a phone produces and the ones that
actually leak a location:

| Format | Where the metadata lives |
|---|---|
| JPEG | APP1 (EXIF, XMP), APP2 (ICC), APP13 (IPTC), COM |
| PNG | `tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME` chunks |
| WebP | RIFF chunks `EXIF`, `XMP `, `ICCP` |
| MP4 / MOV / M4A | `udta` and `meta` boxes, `©xyz` (GPS), `mvhd` timestamps |
| MP3 | ID3v2 at the head, ID3v1 at the tail |

PDF and Office documents are deliberately out of the first pass. They are worth
having and the module is shaped to take them, but a zip container brings its own
complexity and the leak that matters most is in phone photographs and video.

**A format that is not in that table is reported as unrecognised.** It is never
described as cleaned. Saying "removed" about a file nothing was read from is the
kind of promise this project does not make - the same reasoning that keeps a
pitch-shifted voice from being called protected.

## What it is not

- Not a metadata *forensics* tool. It reads what the containers declare, not
  what a codec's entropy might reveal.
- Not a re-encoder. Pixels and samples are copied through untouched, so
  stripping is lossless and fast. A file that has been stripped is bit-identical
  to the original everywhere except the parts that were removed.
- Not a guarantee against every identifying trace. Sensor noise patterns,
  encoder fingerprints and printer dots survive any metadata edit. The tab says
  so where a reader will see it.

## Architecture

### `js/metadata.js`

A module with no dependencies, loaded like the other payload scripts. It does
not touch the DOM and knows nothing about chat: it takes bytes and returns bytes
or a description of them, so it can be tested on its own and used from anywhere.

```
readMetadata(file)            -> { format, supported, fields[], warnings[] }
writeMetadata(file, changes)  -> Blob            // a copy, edits applied
stripMetadata(file)           -> { blob, removed[], supported }
```

`fields[]` entries are `{ id, group, label, value, risk }`. `risk` is one of
`location`, `device`, `identity`, `time`, `other` - what the field would tell
somebody, not how large it is. That is what lets the UI say which lines matter
without the reader having to know what `GPSLatitudeRef` means.

`supported: false` is the honest answer for anything the table above does not
cover. Callers must not treat it as success.

Internally, one reader per container, each answering the same three questions.
Adding PDF later means adding a file, not changing the callers.

### The tab

`content-metadata`, beside the other tools.

1. Drop a file, or pick one.
2. Every field, grouped, with the risky ones marked.
3. Edit a value in place, clear one field, or clear everything.
4. Save a copy. The original is never written to.

The size of the copy is shown next to the original's, because "the file got
smaller" is the plainest evidence that something was removed.

### In Secure Chat

One call, in the send path, before encryption - so the relay and the recipient
both receive a file that was cleaned on this device rather than trusted to be
cleaned elsewhere.

A setting governs it, and **it is on by default**. Somebody sending a photograph
from their phone should not have to know about EXIF to avoid sending their home
address. When it is turned off, sending a file that carries location data warns
once, naming what is in it.

An unrecognised format is passed through unchanged and, when the setting is on,
noted quietly in the transfer banner - the user is told the file went as it was.

## Failure and honesty

| Situation | What happens |
|---|---|
| Format not recognised | `supported: false`, file untouched, said plainly |
| File is corrupt or truncated | Parse abandoned, original returned, error surfaced |
| A field cannot be written | That field reported as unchanged; the rest still apply |
| Stripping would produce an unreadable file | Original returned; never a broken copy |

The rule throughout: when the module is unsure, the user's file is returned as
it was and the user is told. It never silently half-works.

## Testing

`tests/e2e/metadata.mjs`, driving the real page.

Fixtures are built at run time rather than committed: a JPEG with a known EXIF
block including GPS coordinates, a PNG with text chunks, an MP4 with a `©xyz`
box, an MP3 with both ID3 versions. Building them in the harness means the test
knows exactly what should be found and exactly what should be gone.

Checks:

- every fixture's known fields are read back, with the GPS ones marked as
  `location`
- after stripping, none of them are found - by searching the output bytes, not
  by asking the module again
- the image still decodes and its pixels are unchanged
- editing one field changes that field and leaves the others alone
- an unrecognised format reports `supported: false` and returns identical bytes
- with the setting on, a file sent through Secure Chat arrives without its GPS
- with the setting off, sending that file warns first

## What this does not settle

The voice changer and the file manager are separate subsystems with their own
specs. This one is complete on its own: nothing here depends on either, and
neither depends on this.
