#!/usr/bin/env python
"""
Convert Highways Agency PredefinedLocationLinks message into JSON.

Usage:
    linksxml2json.py [options] <xmlfile> <jsonfile>

Options:
    -h, --help          Show a brief usage summary.
"""

# Requires trafficutils from
# https://git.csx.cam.ac.uk/x/eng-sigproc/u/rjw57/srf/trafficutils.git

# Requires docopt from pypi

import json
import sys

import docopt
import trafficutils.io

def main():
    opts = docopt.docopt(__doc__)
    G = trafficutils.io.load_traffic_network(opts['<xmlfile>'])

    node_map = {}
    nodes = []
    for n, data in G.nodes_iter(data=True):
        outd, ind = G.out_degree(n), G.in_degree(n)

        if outd == 1 and ind == 0:
            type_ = 'source'
        elif outd == 0 and ind == 1:
            type_ = 'sink'
        else:
            type_ = 'link'

        record = { 'type': type_, 'data': data }
        nodes.append(record)
        node_map[n] = len(nodes)-1

    edges = []
    for u, v, data in G.edges_iter(data=True):
        record = { 'u': node_map[u], 'v': node_map[v], 'data': data }
        edges.append(record)

    with open(opts['<jsonfile>'], 'w') as f:
        json.dump({
            'source': opts['<xmlfile>'],
            'nodes': nodes,
            'edges': edges,
        }, f)

if __name__ == '__main__':
    main()
