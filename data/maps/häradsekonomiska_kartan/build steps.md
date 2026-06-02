Used the following steps to generate tiles:

1. gdalwarp -s_srs EPSG:3006 -t_srs EPSG:3857 map.tif map_3857.vrt
2. gdal2tiles --xyz --tiledriver=WEBP map_3857.vrt tiles

map.tif is generated from QGIS with TPS transformation.