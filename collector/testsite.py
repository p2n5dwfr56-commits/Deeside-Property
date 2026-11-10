"""A pretend agent website with REPRESENTATIVE TEST DATA (fictional addresses marked [TEST]), in the same page layout as
the real one. Used by test_collect.py and by `collect.py --test-site` so the whole daily process (database, comparison,
encrypted storage, website) can be checked without touching a real site. Day 1, 2, 3 ... follow the scenario below."""
import urllib.parse

PLACES = {  # id: (address, property type, floor area m²)
    'T1': ('[TEST] 1 Example Road, Banchory, Aberdeenshire, AB31 1AA', 'Detached', 140),
    'T2': ('[TEST] 2 Sample Crescent, Banchory, Aberdeenshire, AB31 1AB', 'Semi Detached', 95),
    'T3': ('[TEST] 3 Demo Place, Torphins, Banchory, Aberdeenshire, AB31 4AA', 'Bungalow', 88),
    'T4': ('[TEST] Flat 4, 9 Model Court, Aboyne, Aberdeenshire, AB34 5AA', 'Flat', 62),
    'T5': ('[TEST] Test Cottage, Ballater, Aberdeenshire, AB35 5AA', 'Cottage', 70),
    'T6': ('[TEST] 6 New Build Way, Banchory, Aberdeenshire, AB31 1AC', 'Detached', 160),
    'T7': ('[TEST] Old Mill, Drumoak, Banchory, Aberdeenshire, AB31 5AA', 'Detached', 210),     # a neighbouring village
}
SEARCH = {'Banchory': ['T1', 'T2', 'T3', 'T6', 'T7'], 'Torphins': ['T3'], 'Aboyne': ['T4'], 'Ballater': ['T5'],
          "Kincardine O'Neil": [], 'Lumphanan': []}
DAYS = [  # status and asking price per listing; missing = not on the website that day
    {'T1': ('For Sale', 350000), 'T2': ('For Sale', 225000), 'T3': ('For Sale', 240000), 'T4': ('For Sale', 120000),
     'T5': ('For Sale', 199000), 'T7': ('For Sale', 515000)},
    {'T1': ('For Sale', 335000), 'T2': ('Under Offer', 225000), 'T3': ('For Sale', 245000), 'T4': ('Sold', 120000),
     'T6': ('For Sale', 425000), 'T7': ('For Sale', 515000)},
    {'T1': ('For Sale', 335000), 'T2': ('For Sale', 225000), 'T3': ('For Sale', 245000), 'T4': ('Sold', 120000),
     'T5': ('For Sale', 189000), 'T6': ('For Sale', 425000), 'T7': ('For Sale', 499000)},
]

def card(pid, status, price):
    beds = {'T4': 1, 'T5': 2}.get(pid, 3)
    return (f'<div><a href="/properties/property-detail?propertyId={pid}"\n tabindex="-1" aria-hidden="true"></a>'
            f'<div class="flex justify-between items-center mb-4 font-semibold"> <p>{status}</p> <p>Offers Over</p> </div>'
            f'<h3 class="text-grey-dark"> {PLACES[pid][0]} </h3> <p class="font-semibold"> &#xA3;{price:,} </p>'
            f'<ul><li>{beds} Bedrooms</li><li>1 Living Rooms</li><li>1 Bathrooms</li></ul></div>')

def fetcher_for(day):
    listings = DAYS[(day - 1) % len(DAYS)]
    class TestSite:
        def __init__(self):
            self.count = 0
        def get(self, url):
            self.count += 1
            if 'propertyId=' in url:
                _, t, a = PLACES[url.split('propertyId=')[1]]
                return f'<div>Type</div><div>:</div><div>house</div><div>Dimensions</div><div>:</div><div>{a} m²</div><div>{t}</div>'
            town = urllib.parse.unquote(url.split('address=')[1].split('&')[0])
            return '<html>' + ''.join(card(p, *listings[p]) for p in SEARCH.get(town, []) if p in listings) + '</html>'
    return TestSite
