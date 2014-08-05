#!/usr/bin/env python
"""
Convert Highways Agency PredefinedLocationLinks message into GeoJSON.

Usage:
    linksxml2geojson.py [options] <xmlfile> <jsonfile>

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
    features = []

    # Create node features
    node_map = {}
    node_types = {}
    for n, data in G.nodes_iter(data=True):
        outd, ind = G.out_degree(n), G.in_degree(n)

        if outd == 1 and ind == 0:
            type_ = 'source'
        elif outd == 0 and ind == 1:
            type_ = 'sink'
        else:
            type_ = 'link'
        node_types[n] = type_

        properties = { '_type': 'node', '_nodetype': type_ }
        properties.update(data)

        id_ = data['label'] if 'label' in data else 'Node{0}'.format(len(node_map))
        feature = {
            'id': id_,
            'type': 'Feature',
            'geometry': { 'type': 'Point', 'coordinates': n },
            'properties': properties
        }

        # Add the node feature to the output.
        #features.append(feature)
        node_map[n] = feature['id']

    # Create edge features
    for u, v, data in G.edges_iter(data=True):
        ut, vt = tuple(node_types[n] for n in (u,v))
        if (ut == 'sink' and vt == 'link') or (vt == 'sink' and ut == 'link'):
            type_ = 'sink'
        elif (ut == 'source' and vt == 'link') or (vt == 'source' and ut == 'link'):
            type_ = 'source'
        elif ut == 'link' and vt == 'link':
            type_ = 'link'
        else:
            # What sort of link is *this*?
            assert False

        properties = {
            '_type': 'edge',
            '_edgetype': type_,
            '_u': node_map[u],
            '_v': node_map[v],
        }
        properties.update(data);

        feature = {
            'id': data['id'],
            'type': 'Feature',
            'geometry': { 'type': 'LineString', 'coordinates': (u, v) },
            'properties': properties,
        }
        features.append(feature)

    with open(opts['<jsonfile>'], 'w') as f:
        json.dump({
            'type': 'FeatureCollection',
            'features': features,
            'properties': {
                'source': opts['<xmlfile>'],
            },
        }, f)

if __name__ == '__main__':
    main()
