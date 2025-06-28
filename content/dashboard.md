+++
date = '2025-06-28T09:52:24+12:00'
draft = true
title = 'Dashboard'
+++

# Product Dashboard

This page demonstrates how to use aggregated data from our SQLite database in Hugo.

## Site Statistics

{{< stats >}}

## Products by Category

{{< products-by-category >}}

## All Products

{{< products-table >}}

---

*Data last updated: {{ .Site.Data.stats.last_updated }}*
