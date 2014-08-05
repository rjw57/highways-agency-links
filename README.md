# Map of the UK Highways Agency "Predefined Links"

The UK Highways Agency publishes a set of [realtime traffic
information](http://data.gov.uk/dataset/live-traffic-information-from-the-highways-agency-road-network)
as a series of XML documents. This repository contains a simple webapp which
shows the available links on a map.

## Requirements

* Node and ``npm``.
* Bower
* Python with my [trafficutils](https://git.csx.cam.ac.uk/x/eng-sigproc/u/rjw57/srf/trafficutils.git) package installed.

## Building

```console
$ git clone https://github.com/rjw57/highways-agency-links
$ cd highways-agency-links
$ pip install -r requirements.txt
$ npm install && bower install
$ grunt build
```

There is also a ``quickbuild`` grunt task which avoids the lengthy fetching and
parsing of the predefined location links data.

## Deploying

```console
$ pip install ghp-import
$ grunt build && ghp-import -n -p dist/
```
