from rest_framework.routers import DefaultRouter

from .views import RaceViewSet, TrackViewSet

router = DefaultRouter()
router.register("tracks", TrackViewSet, basename="track")
router.register("races", RaceViewSet, basename="race")
urlpatterns = router.urls
