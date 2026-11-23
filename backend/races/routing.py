from django.urls import re_path

from .consumers import RaceConsumer

websocket_urlpatterns = [re_path(r"^ws/races/(?P<race_id>\d+)/$", RaceConsumer.as_asgi())]
