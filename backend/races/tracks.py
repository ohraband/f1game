"""Premade tracks.

Each track is a handful of control points on a 1000x600 canvas. They are
smoothed with a Catmull-Rom spline and resampled into an evenly spaced
centerline, which is all the rest of the backend needs (position at distance d,
distance of a click to the track).
"""
import math

WIDTH = 36   # track width in canvas units
STEP = 4     # centerline point spacing
SAMPLES = 30
MAX_LIMIT, MIN_LIMIT, LIMIT_K = 270, 130, 220  # corner speed limit model


def _catmull_rom(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return tuple(
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
        for a, b, c, d in zip(p0, p1, p2, p3)
    )


def _centerline(control):
    n = len(control)
    dense = []
    for i in range(n):
        p0, p1, p2, p3 = (control[(i + k) % n] for k in (-1, 0, 1, 2))
        dense += [_catmull_rom(p0, p1, p2, p3, s / SAMPLES) for s in range(SAMPLES)]

    cum = [0.0]
    for i in range(len(dense)):
        cum.append(cum[-1] + math.dist(dense[i], dense[(i + 1) % len(dense)]))
    count = round(cum[-1] / STEP)
    spacing = cum[-1] / count

    pts, j = [], 0
    for k in range(count):
        target = k * spacing
        while cum[j + 1] < target:
            j += 1
        seg = cum[j + 1] - cum[j]
        t = (target - cum[j]) / seg if seg else 0
        a, b = dense[j], dense[(j + 1) % len(dense)]
        pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return pts, spacing


class Track:
    width = WIDTH

    def __init__(self, key, name, country, control):
        self.key, self.name, self.country = key, name, country
        self.points, self.spacing = _centerline(control)
        self.length = self.spacing * len(self.points)
        self.limits = self._corner_limits()

    def _corner_limits(self, w=10):
        """Max safe speed per centerline point: the sharper the turn around it, the lower."""
        n, pts = len(self.points), self.points
        h = [math.atan2(pts[(i + 1) % n][1] - pts[i][1], pts[(i + 1) % n][0] - pts[i][0]) for i in range(n)]
        out = []
        for i in range(n):
            diff = h[(i + w) % n] - h[(i - w) % n]
            turn = abs(math.atan2(math.sin(diff), math.cos(diff)))
            out.append(max(MIN_LIMIT, min(MAX_LIMIT, MAX_LIMIT - LIMIT_K * turn)))
        return out

    def _index(self, d):
        return int((d % self.length) / self.spacing) % len(self.points)

    def limit_at(self, d):
        return self.limits[self._index(d)]

    def limit_ahead(self, d, dist=100):
        i, n = self._index(d), len(self.points)
        return min(self.limits[(i + j) % n] for j in range(int(dist / self.spacing) + 1))

    def point_at(self, d):
        """(x, y, heading) at distance d along the lap. The start line is d=0; negative d is behind it."""
        f = (d % self.length) / self.spacing
        i, t = int(f) % len(self.points), f - int(f)
        (x1, y1), (x2, y2) = self.points[i], self.points[(i + 1) % len(self.points)]
        return x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, math.atan2(y2 - y1, x2 - x1)

    def distance_to(self, x, y):
        return min(math.hypot(x - px, y - py) for px, py in self.points)


_DEFS = [
    # Pit straight top-left, clockwise: Rettifilo, Curva Grande, Roggia, Lesmos, Ascari, Parabolica
    ("monza", "Monza-ish", "Italy", [
        (200, 190), (330, 188), (450, 187), (530, 188), (555, 194), (575, 212), (603, 212), (626, 194),
        (655, 185), (720, 178), (790, 188), (840, 222), (862, 265), (868, 298), (882, 314), (872, 336),
        (866, 370), (842, 396), (802, 408), (768, 420), (752, 444), (716, 456), (660, 466), (600, 474),
        (550, 476), (530, 456), (500, 458), (484, 480), (448, 486), (424, 470), (370, 472), (290, 476),
        (200, 474), (140, 468), (100, 445), (72, 400), (62, 340), (66, 280), (84, 230), (118, 200),
        (160, 191)]),
    # Long pit straight going north, Abbey, Village/Loop, Wellington, Luffield, Maggotts-Becketts, long Hangar straight
    ("silverstone", "Silverstone-ish", "United Kingdom", [
        (150, 470), (150, 370), (150, 270), (160, 222), (180, 196), (210, 178), (245, 155), (285, 128),
        (340, 108), (420, 100), (480, 102), (520, 118), (530, 150), (512, 178), (518, 205), (545, 222),
        (575, 215), (620, 235), (700, 240), (790, 262), (850, 290), (885, 315), (890, 350), (870, 388),
        (840, 408), (805, 412), (765, 430), (725, 460), (690, 486), (640, 494), (595, 486), (570, 502),
        (535, 494), (505, 514), (450, 524), (350, 530), (260, 528), (215, 515), (190, 492), (172, 478)]),
    # Harbour straight, Ste Devote, Casino, hairpin, long tunnel straight, chicane, pool
    ("monaco", "Monaco-ish", "Monaco", [
        (494, 535), (419, 538), (350, 528), (319, 501), (309, 454), (329, 406), (354, 354), (394, 304),
        (450, 266), (506, 244), (569, 231), (632, 231), (688, 244), (716, 278), (722, 322), (734, 356),
        (766, 366), (794, 341), (804, 306), (834, 278), (875, 278), (913, 310), (942, 360), (946, 416),
        (934, 451), (906, 466), (863, 481), (806, 506), (750, 516), (713, 498), (675, 516), (638, 526),
        (594, 536), (556, 528)]),
    # Triangle: La Source, Eau Rouge, long Kemmel straight, Les Combes, Bruxelles, Pouhon, Blanchimont
    ("spa", "Spa-ish", "Belgium", [
        (500, 522), (430, 520), (370, 514), (330, 500), (300, 478), (298, 448), (330, 430), (390, 430),
        (430, 448), (465, 430), (495, 405), (560, 352), (640, 288), (720, 225), (790, 175), (832, 150),
        (870, 165), (878, 205), (868, 245), (856, 285), (838, 325), (808, 348), (770, 352), (730, 375),
        (690, 395), (660, 425), (630, 455), (610, 485), (580, 508), (545, 518)]),
]

TRACKS = {key: Track(key, name, country, pts) for key, name, country, pts in _DEFS}


def get_track(key):
    return TRACKS[key]
