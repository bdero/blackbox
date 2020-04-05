#!/bin/bash
set -x

pushd shared/src/protos/
flatc --ts messages.fbs --no-fb-import
popd
