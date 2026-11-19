"""Build Market Lab's static minute replay from the frozen threebuy research archive.

python3 scripts/eth-replay/export.py /path/to/research-root
Reads saved Ethereum RPC responses, Binance ZIPs, daily formula outputs and fills offline.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import subprocess
import zipfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

SWAP = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
MINT = '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde'
BURN = '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c'


def read(path):
    return json.loads(path.read_bytes())


def write(path, value):
    path.write_text(json.dumps(value, separators=(',', ':'), ensure_ascii=False))


def rpc(raw, method, params):
    body = dict(jsonrpc='2.0', id=1, method=method, params=params)
    key = hashlib.sha256(json.dumps(body).encode()).hexdigest()
    return json.loads(gzip.decompress((raw / (key + '.rpc.gz')).read_bytes()))


def logs(raw, addresses, a, b, topics):
    try:
        return rpc(raw, 'eth_getLogs', [dict(address=addresses, fromBlock=hex(a), toBlock=hex(b), topics=topics)])
    except FileNotFoundError:
        if a == b:
            raise
        mid = (a + b) // 2
        return logs(raw, addresses, a, mid, topics) + logs(raw, addresses, mid + 1, b, topics)


def signed(n):
    return n - 2**256 if n >= 2**255 else n


def bounds(pool, rates):
    symbol = pool['name'].split('/')[1].split('-')[0]
    price = lambda k: Decimal(str(rates[k]['price']))
    quote = price('BTC') * price('WBTCBTC') if symbol == 'WBTC' else price(symbol)
    p = price('ETH') / quote * Decimal(10)**((8 if symbol == 'WBTC' else 6) - 18)
    q = p * Decimal('.995')
    if not pool['eth0']:
        p, q = 1 / p, 1 / q
    return sorted((p.sqrt(), q.sqrt()))


def liquidity_delta(event, words, pool, band):
    lo, hi = (signed(int(x, 16)) for x in event['topics'][2:4])
    lo = max(band[0], Decimal('1.0001')**(Decimal(lo) / 2))
    hi = min(band[1], Decimal('1.0001')**(Decimal(hi) / 2))
    if hi <= lo:
        return 0
    width = 1 / lo - 1 / hi if pool['eth0'] else hi - lo
    quantity = words[-3] * width / (10**18 * (1 - Decimal(pool['fee']) / 10**6))
    return float(quantity if event['topics'][0] == MINT else -quantity)


def window(raw, day, pools):
    snapshot = read(raw / (day + '-observed.json'))
    start = int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
    blocks = snapshot['blocks']
    addresses = [p['address'] for p in pools]
    bands = [bounds(p, snapshot['rates']) for p in pools]
    frames = [[[0., 0., 0.] for _ in range(179)] for p in pools]  # depth change, buy, sell
    swap = logs(raw, addresses, blocks[0]+1, blocks[-1], [SWAP])
    changes = logs(raw, addresses, blocks[1]+1, blocks[-1], [[MINT, BURN]])
    for e in swap + changes:
        assert not e['removed']
        stamp = e.get('blockTimestamp') or rpc(raw, 'eth_getBlockByNumber', [e['blockNumber'], False])['timestamp']
        minute = (int(stamp, 16) - start) // 60
        if minute < 0:
            continue  # five-minute swap warm-up for impact matching only
        i = addresses.index(e['address'].lower())
        frame = frames[i][minute]
        data = e['data'][2:]
        words = [int(data[j:j+64], 16) for j in range(0, len(data), 64)]
        if e['topics'][0] == SWAP:
            amount = signed(words[0 if pools[i]['eth0'] else 1]) / 1e18
            frame[1 if amount < 0 else 2] += abs(amount)
        else:
            frame[0] += liquidity_delta(e, words, pools[i], bands[i])
    initial = []
    for p, series in zip(snapshot['pools'], frames):
        depth = p['fixed'][0]
        initial.append(depth)
        for j, (a, b) in enumerate(((0, 60), (60, 120), (120, 179))):
            delta, buy, sell = map(sum, zip(*series[a:b]))
            depth += delta
            assert abs(depth - p['fixed'][j+1]) < 1e-6, (day, p['pool'], j)
            assert max(abs(buy-p['flow'][j][1]), abs(sell-p['flow'][j][0])) < 1e-6
    return dict(initial=initial, frames=frames, usd=snapshot['rates']['ETH']['price'],
                impact=snapshot['impact'], comparable=snapshot['comparable'],
                matched=snapshot['matchedPools'], counts=snapshot['distinctTransactions'])


def prices(raw, month, market, days):
    with zipfile.ZipFile(raw / f'{market}-ETHUSDT-1m-{month}.zip') as archive:
        with archive.open(archive.namelist()[0]) as file:
            for r in csv.reader(io.TextIOWrapper(file)):
                if not r[0].isdigit():
                    continue
                dt = datetime.fromtimestamp(int(r[0])/1000, timezone.utc)
                entry = days[dt.date().isoformat()]
                minute = dt.hour*60 + dt.minute
                entry[market][minute] = round(float(r[4])*100)
                if minute == 0:
                    entry[market+'Open'] = float(r[1])


def fills(out):
    result = []
    base_exits = []
    with (out / '两账户逐笔成交.csv').open(encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            if r['策略'] == '只做卖压承接':
                base_exits.append(dict(time=r['平仓'], net=float(r['净损益'])))
                continue
            assert r['策略'] == '承接加三段净买'
            result.extend([
                dict(time=r['开仓'], side='buy', route=r['路径'], price=float(r['买入参考价']),
                     target=float(r['目标']), stop=float(r['止损']), expiry=int(r['到期'])),
                dict(time=r['平仓'], side='sell', route=r['路径'], price=float(r['卖出参考价']),
                     reason=r['平仓原因'], gross=float(r['价格损益']), slip=float(r['滑点']),
                     fee=float(r['手续费']), net=float(r['净损益']))])
    return sorted(result, key=lambda x: x['time']), sorted(base_exits, key=lambda x: x['time'])


def export(root, dest):
    src = root / 'work/threebuy'
    raw = src / 'raw'
    script = Path(__file__).with_name('daily.mjs')
    signals = json.loads(subprocess.check_output(['node', script, src]))
    pools = read(root / 'work/multipool/pools.json')
    dest.mkdir(parents=True, exist_ok=True)
    for month in sorted({s['date'][:7] for s in signals}):
        days = {}
        for s in signals:
            day = s['date']
            if not day.startswith(month):
                continue
            row = dict(signal=s, spot=[None]*1440, perp=[None]*1440)
            if s.get('eligible'):
                row['chain'] = window(raw, day, pools)
            days[day] = row
        for market in ('spot', 'perp'):
            prices(raw, month, market, days)
        write(dest / (month+'.json'), days)
    events, base = fills(root / 'outputs/eth-threebuy')
    write(dest / 'index.json', dict(days=[s['date'] for s in signals], pools=pools,
          fills=events, baseExits=base))


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('root', type=Path)
    cli.add_argument('--output', type=Path, default=Path('public/data/eth-decision'))
    args = cli.parse_args()
    export(args.root, args.output)
