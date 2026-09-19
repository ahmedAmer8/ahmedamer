---
title: The 466 MB directory that reports as 296 KB
slug: du-lies-about-sparse-files
summary: >-
  A container image was heavy because of a directory the usual size command says is
  tiny. Sparse files have an apparent size and an allocated size, and a build context
  archives the apparent one.
date: 2026-07-22
status: fixed
category: deployment
magnitude: 5
principle: >-
  Measure the thing the consumer measures. A build context archives apparent size;
  the tool you reach for reports allocated size. They are different numbers for the
  same directory.
projects: [conversational-commerce-platform]
technologies: [docker, python]
topics: [instrument-error, deployment-drift, cost]
lessons: [cost-dashboard-overstated-by-3.8x]
---

## The contradiction

An image layer was 466 MB larger than the files it should have contained. Checking the
suspect directory:

```
$ du -sh qdrant_storage/
296K
```

Both measurements were correct.

## Two sizes for one file

A sparse file has holes: regions that read as zeros but occupy no blocks on disk. A
vector database preallocates large files this way. So the file has two sizes:

- **Allocated** — the blocks actually on disk. This is what `du` reports, and what
  your disk usage is.
- **Apparent** — the length of the file as far as any reader is concerned. This is
  what `ls -l` reports, and what anything that *reads the file end to end* has to
  handle.

A container build context is a reader. It archives the file, which means it reads all
of it, including the holes, and writes out the zeros. 296 KB on disk became 233 MB in
the build context and 466 MB in the layer.

::: principle
Disk usage and transfer size are different quantities, and for sparse files they
differ by orders of magnitude. When a size is surprising, check which of the two your
tool is reporting and which one the consumer cares about.
:::

One line in the build exclusions took the image from 1.8 GB to 1.32 GB.

## The metric that was actually wrong

Total image size turned out to be the wrong headline anyway.

What a deploy costs is not the size of the image, it is the size of the layers that
are not already cached on the target. Almost all of that 1.8 GB was stable base layers
that never move. The number that determines how long a deploy takes is the uncached
tail, and that went from 565 MB to 78 MB — roughly a sevenfold faster deploy cycle,
from a change that only improved total size by a quarter.

::: principle
Optimise the quantity that produces the pain. "Image size" is a headline; "bytes
transferred per deploy" is the thing you are actually waiting for, and the two respond
to completely different changes.
:::

## Three more that were not intuitive

While measuring properly, three other assumptions failed:

- A recursive ownership change on a copied tree **duplicates it**. Changing metadata
  on files rewrites them into a new layer, so the tree exists twice in the image, and
  that layer can never be cached because it depends on everything above it.
- Deleting a build directory in a later step **reclaims nothing**. Layers are additive;
  a deletion adds a layer recording the deletion. The bytes stay in the image. It has
  to not be copied in the first place.
- One database driver was 70 MB where an equivalent is 2 MB. Nobody had chosen the
  large one; it arrived as a transitive dependency and stayed.

All four findings came from measuring layer by layer rather than looking at the total.
The total tells you there is a problem and nothing about where it is.
