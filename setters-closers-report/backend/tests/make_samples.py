"""Creates placeholder input files (no real people) for tests and demos:
dialer CSV, booking screenshot and CC screenshot."""
import csv
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "samples"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

CSV_ROWS = [
    # name, email, team, calls, connected, talk time (h:mm:ss), host time (minutes)
    ("Setter Alpha", "setter.alpha@example.com", "Setter Team", 142, 61, "1:42:10", "128"),
    ("Setter Bravo", "setter.bravo@example.com", "Setter Team", 118, 47, "1:12:35", "96"),
    ("Setter Charlie", "setter.charlie@example.com", "Setter Team", 97, 33, "0:58:20", "84"),
    ("Setter Delta", "setter.delta@example.com", "Setter Team", 131, 52, "1:31:05", ""),
    ("Closer Echo", "closer.echo@example.com", "Closer Team", 64, 38, "2:05:40", "141"),
    ("Closer Foxtrot", "closer.foxtrot@example.com", "Closer Team", 51, 29, "1:20:00", "88"),
]
BOOKINGS = [("Setter Alpha", "7"), ("Setter Bravo", "5"), ("Setter Charly", "3"), ("Setter Delta", "0"),
            ("Closer Echo", "4"), ("Total", "19")]
CC = [("Setter Alpha", "2"), ("Setter Bravo", "1"), ("Closer Echo", "3"), ("Closer Foxtrot", "2")]


def table_png(path, headers, rows, scale=1):
    font = ImageFont.truetype(FONT, 22 * scale)
    bold = ImageFont.truetype(FONT.replace("Sans.ttf", "Sans-Bold.ttf"), 22 * scale)
    widths = [300 * scale] + [180 * scale] * (len(headers) - 1)
    rh = 46 * scale
    img = Image.new("RGB", (sum(widths) + 40 * scale, rh * (len(rows) + 1) + 40 * scale), "white")
    d = ImageDraw.Draw(img)
    y = 20 * scale
    for ri, row in enumerate([headers] + rows):
        x = 20 * scale
        if ri == 0:
            d.rectangle([x, y, x + sum(widths), y + rh], fill="#EEF1F6")
        for ci, val in enumerate(row):
            d.text((x + 12 * scale, y + 11 * scale), str(val), fill="#111", font=bold if ri == 0 else font)
            x += widths[ci]
        d.line([20 * scale, y + rh, 20 * scale + sum(widths), y + rh], fill="#D0D5DD", width=1)
        y += rh
    img.save(path)


def main():
    OUT.mkdir(exist_ok=True)
    with open(OUT / "dialer.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Agent Name", "Email", "Team", "Total Calls", "Connected", "Talk Time", "Host Time"])
        w.writerows(CSV_ROWS)
    table_png(OUT / "booking.png", ["Agent", "Bookings"], [list(r) for r in BOOKINGS])
    table_png(OUT / "cc.png", ["Agent", "CC"], [list(r) for r in CC])
    print("samples written to", OUT)


if __name__ == "__main__":
    main()
